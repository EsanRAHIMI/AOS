/**
 * K2 D-178 — real OpenAI-compatible tool-calling WIRE proof.
 *
 * This is NOT a mock of "intelligence": it stands up a real HTTP server that
 * implements the OpenAI `/v1/chat/completions` contract (the exact shape
 * Ollama / vLLM / LM Studio serve) and drives the PRODUCTION
 * `OpenAICompatibleToolsProvider` against it over a real socket. It proves the
 * request/response wire format — tool schema serialization, tool_call parsing,
 * multi-turn tool-result threading, usage accounting — is correct against a
 * real server, so that when a real capable model is configured
 * (LLM_LOCAL_BASE_URL), the provider works unchanged.
 *
 * It deliberately does NOT assert reasoning quality — that requires a real
 * model and is reported as BLOCKED_EXTERNAL in this environment (no model
 * weights or inference endpoint reachable through the sandbox allowlist).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OpenAICompatibleToolsProvider, AnthropicToolsProvider, modelRegistryFromEnv } from '../src/llm/toolcalling.js';
import type { LoopMessage } from '../src/agentcore/schemas.js';

let server: Server;
let baseUrl: string;
let lastRequest: Record<string, unknown> | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = JSON.parse(body || '{}');
      const msgs = (lastRequest.messages as Array<Record<string, unknown>>) ?? [];
      const tools = (lastRequest.tools as Array<{ function?: { name?: string } }>) ?? [];
      const hasToolResult = msgs.some((m) => m.role === 'tool');
      // Real OpenAI wire shape: if a tool is offered and we haven't observed a
      // tool result yet, request the tool; otherwise return a final message.
      const message = (!hasToolResult && tools.length)
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: tools[0].function?.name, arguments: '{"q":"x"}' } }] }
        : { role: 'assistant', content: 'final answer from the real HTTP server', tool_calls: [] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1`;
});

afterAll(() => server.close());

const um = (text: string): LoopMessage => ({ role: 'user', content: text, toolCalls: [], toolCallId: '', toolName: '' });

describe('OpenAI-compatible provider — real HTTP wire (Ollama/vLLM shape)', () => {
  it('serializes tool schemas and parses a tool_call from a real server response', async () => {
    const provider = new OpenAICompatibleToolsProvider(baseUrl, 'local', true);
    const res = await provider.chat({
      system: 'sys', messages: [um('do it')],
      tools: [{ name: 'memory_search', description: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
      model: 'test-model',
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.toolName).toBe('memory_search');
    expect(res.toolCalls[0]!.args).toEqual({ q: 'x' });
    expect(res.costUsd).toBe(0); // local → free, honestly
    // The server actually received OpenAI-shaped tools.
    expect((lastRequest!.tools as unknown[]).length).toBe(1);
    expect(JSON.stringify(lastRequest!.tools)).toContain('memory_search');
  });

  it('threads a tool result back as an OpenAI tool message and gets a final answer', async () => {
    const provider = new OpenAICompatibleToolsProvider(baseUrl, 'local', true);
    const messages: LoopMessage[] = [
      um('do it'),
      { role: 'assistant', content: '', toolCalls: [{ callId: 'call_0', toolName: 'memory_search', args: { q: 'x' } }], toolCallId: '', toolName: '' },
      { role: 'tool', content: 'result: alpha', toolCalls: [], toolCallId: 'call_0', toolName: 'memory_search' },
    ];
    const res = await provider.chat({ system: 'sys', messages, tools: [], model: 'test-model' });
    expect(res.text).toContain('final answer');
    // The server received a properly-shaped tool message.
    const sent = (lastRequest!.messages as Array<Record<string, unknown>>);
    expect(sent.some((m) => m.role === 'tool' && m.tool_call_id === 'call_0')).toBe(true);
    expect(sent.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))).toBe(true);
  });
});

describe('model registry resolution (independence, no hardcoded IDs)', () => {
  it('LLM_LOCAL_BASE_URL → local openai-compatible, isLocal, cost 0', () => {
    const reg = modelRegistryFromEnv({ LLM_LOCAL_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_LOCAL_MODEL: 'qwen2.5:7b' } as unknown as NodeJS.ProcessEnv);
    expect(reg.provider).toBe('openai-compatible');
    expect(reg.isLocal).toBe(true);
    expect(reg.models.standard).toBe('qwen2.5:7b');
  });
  it('no config → degraded (none), never a hardcoded default that pretends to work', () => {
    const reg = modelRegistryFromEnv({} as NodeJS.ProcessEnv);
    expect(reg.provider).toBe('none');
  });
  it('tier overrides are honored (LLM_MODEL_*)', () => {
    const reg = modelRegistryFromEnv({ ANTHROPIC_API_KEY: 'k', LLM_MODEL_REASONING: 'claude-x', LLM_MODEL_FAST: 'haiku-x' } as unknown as NodeJS.ProcessEnv);
    expect(reg.models.reasoning).toBe('claude-x');
    expect(reg.models.fast).toBe('haiku-x');
  });

  // OPTIONAL real-endpoint gate: when LLM_VERIFY_BASE_URL is set (a real
  // Ollama/vLLM), prove the provider works against IT. Skips otherwise —
  // exactly like the BullMQ real-Redis integration gate.
  const VERIFY = process.env.LLM_VERIFY_BASE_URL;
  it.skipIf(!VERIFY)('drives a REAL configured local endpoint end-to-end', async () => {
    const provider = new OpenAICompatibleToolsProvider(VERIFY!.replace(/\/$/, ''), process.env.LLM_VERIFY_API_KEY ?? 'local', true);
    const res = await provider.chat({ system: 'You are terse.', messages: [um('Reply with the word: ready')], tools: [], model: process.env.LLM_VERIFY_MODEL ?? 'qwen2.5:7b' });
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
  }, 30000);
});

// Reference the Anthropic provider so the reachable-host cloud path stays type-checked.
void AnthropicToolsProvider;
