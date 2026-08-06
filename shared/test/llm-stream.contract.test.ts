/**
 * Streaming WIRE proof (D-213).
 *
 * Driven against a REAL HTTP server over a real socket, following the pattern
 * of `toolcalling.integration.test.ts` — not a stubbed `fetch`. Two reasons,
 * and the first one is not stylistic: `fetchWithRetry` uses undici's own fetch
 * whenever a timeout is configured, so a stubbed global is never consulted and
 * a test written that way passes while proving nothing. The second is that
 * chunk boundaries are the entire risk here. A real socket splits records
 * wherever it likes; the response is written in deliberately awkward pieces to
 * make that certain.
 *
 * The invariant under test is not "deltas arrive" — it is that a streamed turn
 * and an unstreamed one produce the SAME ChatResult. Everything downstream
 * (usage, cost records, budget arithmetic, tool dispatch, approval
 * checkpoints) reads that object and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  AnthropicToolsProvider, OpenAICompatibleToolsProvider,
  type ChatDelta, type ChatRequest,
} from '../src/llm/toolcalling.js';

const req: ChatRequest = {
  system: 'you are jarvis',
  messages: [{ role: 'user', content: 'book the gym tomorrow', toolCalls: [], toolCallId: '', toolName: '' }],
  tools: [{ name: 'calendar_create_event', description: 'create', inputSchema: { type: 'object' } }],
  model: 'test-model',
};

/** SSE records the next request will be answered with. */
let script: string[] = [];
/** Body of the most recent request, for asserting what we asked the provider for. */
let lastRequest: Record<string, unknown> = {};
let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((rq, res) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', async () => {
      lastRequest = JSON.parse(body || '{}') as Record<string, unknown>;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      /* Written in 9-byte slices with a tick between them. That cuts JSON
       * objects — and multi-byte Persian characters — across TCP reads, which
       * is precisely what a naive line reader gets wrong. */
      const wire = Buffer.from(script.map((r) => `${r}\n\n`).join(''), 'utf8');
      for (let i = 0; i < wire.length; i += 9) {
        res.write(wire.subarray(i, i + 9));
        await new Promise((r) => setImmediate(r));
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => { server.close(); });

const openai = () => new OpenAICompatibleToolsProvider(`${origin}/v1`, 'k', false);
const anthropic = () => new AnthropicToolsProvider('k', false, origin);

describe('OpenAI-compatible chatStream', () => {
  it('reassembles text and tool arguments split across chunks', async () => {
    /* The arguments of one call arrive as four fragments. Only the
     * concatenation is valid JSON — this is the shape that breaks any
     * implementation which assigns rather than appends, leaving the call with
     * just its last fragment, which parses as {} and silently discards every
     * argument the owner gave. */
    script = [
      'data: {"choices":[{"delta":{"content":"باشه"}}]}',
      'data: {"choices":[{"delta":{"content":"، الان"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"calendar_create_event","arguments":"{\\"tit"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"le\\":\\"gy"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"m\\",\\"day\\":2"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}',
      'data: {"usage":{"prompt_tokens":120,"completion_tokens":18,"total_tokens":138,"prompt_tokens_details":{"cached_tokens":96}}}',
      'data: [DONE]',
    ];

    const deltas: ChatDelta[] = [];
    const out = await openai().chatStream(req, (d) => deltas.push(d));

    expect(out.text).toBe('باشه، الان');
    expect(out.toolCalls).toEqual([
      { callId: 'call_a', toolName: 'calendar_create_event', args: { title: 'gym', day: 2 } },
    ]);
    expect(out.tokensIn).toBe(120);
    expect(out.tokensOut).toBe(18);
    expect(out.tokensCached).toBe(96);
    expect(out.usageSource).toBe('provider');
  });

  it('emits text deltas in order, and announces each tool exactly once', async () => {
    script = [
      'data: {"choices":[{"delta":{"content":"one "}}]}',
      'data: {"choices":[{"delta":{"content":"two"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"t","arguments":"{"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}',
      'data: [DONE]',
    ];

    const deltas: ChatDelta[] = [];
    await openai().chatStream(req, (d) => deltas.push(d));

    expect(deltas.filter((d) => d.kind === 'text').map((d) => (d as { text: string }).text))
      .toEqual(['one ', 'two']);
    // Announced on the fragment carrying the name, and not again on the
    // fragments that only carried more arguments.
    expect(deltas.filter((d) => d.kind === 'tool.start')).toEqual([
      { kind: 'tool.start', toolName: 't', callId: 'c1' },
    ]);
  });

  it('asks for usage, which a streamed response otherwise omits entirely', async () => {
    script = ['data: [DONE]'];
    await openai().chatStream(req, () => {});
    expect(lastRequest.stream).toBe(true);
    // Without this the ledger records 0 tokens and maxCostUsd stops binding.
    expect(lastRequest.stream_options).toEqual({ include_usage: true });
  });

  it('survives a malformed record rather than losing the rest of the turn', async () => {
    script = [
      'data: {"choices":[{"delta":{"content":"kept"}}]}',
      'data: {not json at all',
      'data: {"choices":[{"delta":{"content":" too"}}]}',
      'data: [DONE]',
    ];
    const out = await openai().chatStream(req, () => {});
    expect(out.text).toBe('kept too');
  });

  it('drops a tool call that never received a name — an unnamed call is undispatchable', async () => {
    script = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
      'data: [DONE]',
    ];
    const out = await openai().chatStream(req, () => {});
    expect(out.toolCalls).toEqual([]);
  });

  it('keeps two concurrent tool calls apart by index', async () => {
    script = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"first","arguments":"{\\"x\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"second","arguments":"{\\"y\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"2}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
      'data: [DONE]',
    ];
    const out = await openai().chatStream(req, () => {});
    // Interleaved on the wire, ordered by index in the result.
    expect(out.toolCalls).toEqual([
      { callId: 'a', toolName: 'first', args: { x: 1 } },
      { callId: 'b', toolName: 'second', args: { y: 2 } },
    ]);
  });
});

describe('Anthropic chatStream', () => {
  it('reassembles input_json_delta fragments and reports usage from two frames', async () => {
    script = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"cache_read_input_tokens":180}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"سلام"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"calendar_create_event"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"when\\":"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"tomorrow\\"}"}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}',
      'data: {"type":"message_stop"}',
    ];

    const deltas: ChatDelta[] = [];
    const out = await anthropic().chatStream(req, (d) => deltas.push(d));

    expect(out.text).toBe('سلام');
    expect(out.toolCalls).toEqual([
      { callId: 'toolu_1', toolName: 'calendar_create_event', args: { when: 'tomorrow' } },
    ]);
    // Usage arrives in two separate frames; both must be picked up.
    expect(out.tokensIn).toBe(200);
    expect(out.tokensOut).toBe(42);
    expect(out.tokensCached).toBe(180);
    expect(deltas).toContainEqual({ kind: 'tool.start', toolName: 'calendar_create_event', callId: 'toolu_1' });
  });

  it('keeps the cache breakpoint on the streamed request too', async () => {
    script = ['data: {"type":"message_stop"}'];
    await anthropic().chatStream(req, () => {});
    expect(lastRequest.stream).toBe(true);
    expect(lastRequest.system).toEqual([
      { type: 'text', text: 'you are jarvis', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('treats an empty tool input block as {}, not as a parse failure', async () => {
    script = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"personal_state"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_stop"}',
    ];
    const out = await anthropic().chatStream(req, () => {});
    // '' on the wire, {} in intent — a tool taking no arguments is normal.
    expect(out.toolCalls).toEqual([{ callId: 't1', toolName: 'personal_state', args: {} }]);
  });
});
