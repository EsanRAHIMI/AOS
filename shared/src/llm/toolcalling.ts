/**
 * Native tool-calling providers + configurable model registry (K2, D-177).
 *
 * Master-direction C.2: native provider tool use replaces JSON-in-prose as
 * the primary reasoning mode; model IDs move OUT of source into a config
 * registry with tiers. Independence mandate: an OpenAI-COMPATIBLE provider
 * with a configurable base URL serves Ollama / vLLM / LM Studio / any
 * self-hosted endpoint — the product never hardcodes one company.
 *
 * Providers here return STRUCTURE (text + validated tool-call requests +
 * usage). They never execute anything: execution belongs to the governed
 * loop (../agentcore/loop.ts).
 */
import type { LoopMessage } from '../agentcore/schemas.js';
// D-211 — a 429 is flow control, not a failure. See llm/resilience.ts.
import { fetchWithRetry } from './resilience.js';
import { llmHttpConfigFromEnv } from './config.js';
import { withLocalLlmSlot } from './concurrency.js';

/* ----------------------------- model registry --------------------------- */

export type ModelTier = 'reasoning' | 'standard' | 'fast';
export type ModelProviderSelection = 'auto' | 'local' | 'openai' | 'anthropic';

export interface ModelRegistry {
  provider: 'anthropic' | 'openai-compatible' | 'none';
  baseUrl: string;          // openai-compatible only
  apiKey: string;
  models: Record<ModelTier, string>;
  /** true when pointing at a local/self-hosted endpoint (cost = 0). */
  isLocal: boolean;
}

/** Single default table — overridable per env, never scattered hardcodes. */
const DEFAULT_MODELS: Record<string, Record<ModelTier, string>> = {
  anthropic: { reasoning: 'claude-sonnet-4-6', standard: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5' },
  'openai-compatible': { reasoning: 'gpt-4.1', standard: 'gpt-4.1', fast: 'gpt-4.1-mini' },
};

/**
 * Resolve the model registry from env. Priority:
 *  1. LLM_LOCAL_BASE_URL set → openai-compatible against that endpoint
 *     (Ollama's /v1, vLLM, LM Studio...) — the independence default.
 *  2. ANTHROPIC_API_KEY → anthropic native tools.
 *  3. OPENAI_API_KEY → openai-compatible against api.openai.com.
 *  4. none → degraded mode (visible, honest; personal/deterministic tools
 *     still work — mandate: missing cloud keys must not disable core usage).
 */
export function modelRegistryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  selection?: ModelProviderSelection,
): ModelRegistry {
  const configuredSelection = env.LLM_PROVIDER_MODE;
  const selected: ModelProviderSelection = selection
    ?? (configuredSelection === 'local' || configuredSelection === 'openai' || configuredSelection === 'anthropic'
      ? configuredSelection
      : 'auto');
  const tierOverrides = (base: Record<ModelTier, string>, prefix: 'LOCAL' | 'OPENAI' | 'ANTHROPIC'): Record<ModelTier, string> => ({
    reasoning: env[`LLM_${prefix}_MODEL_REASONING`] || env.LLM_MODEL_REASONING || base.reasoning,
    standard: env[`LLM_${prefix}_MODEL_STANDARD`] || env.LLM_MODEL_STANDARD || base.standard,
    fast: env[`LLM_${prefix}_MODEL_FAST`] || env.LLM_MODEL_FAST || base.fast,
  });
  const local = (): ModelRegistry | null => {
    if (!env.LLM_LOCAL_BASE_URL) return null;
    const local = env.LLM_LOCAL_MODEL || 'llama3.1';
    return {
      provider: 'openai-compatible',
      baseUrl: env.LLM_LOCAL_BASE_URL.replace(/\/$/, ''),
      apiKey: env.LLM_LOCAL_API_KEY || 'local',
      models: tierOverrides({ reasoning: local, standard: local, fast: env.LLM_LOCAL_MODEL_FAST || local }, 'LOCAL'),
      isLocal: true,
    };
  };
  const openai = (): ModelRegistry | null => env.OPENAI_API_KEY ? {
    provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY,
    models: tierOverrides({
      reasoning: env.LLM_OPENAI_MODEL || DEFAULT_MODELS['openai-compatible']!.reasoning,
      standard: env.LLM_OPENAI_MODEL || DEFAULT_MODELS['openai-compatible']!.standard,
      fast: env.LLM_OPENAI_MODEL_FAST || DEFAULT_MODELS['openai-compatible']!.fast,
    }, 'OPENAI'), isLocal: false,
  } : null;
  const anthropic = (): ModelRegistry | null => env.ANTHROPIC_API_KEY ? {
    provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: env.ANTHROPIC_API_KEY,
    models: tierOverrides(DEFAULT_MODELS.anthropic as Record<ModelTier, string>, 'ANTHROPIC'), isLocal: false,
  } : null;
  if (selected === 'local') return local() ?? emptyRegistry();
  if (selected === 'openai') return openai() ?? emptyRegistry();
  if (selected === 'anthropic') return anthropic() ?? emptyRegistry();

  // `auto` respects LLM_DEFAULT_PROVIDER (product default: openai). Local
  // remains available explicitly or as the last fallback when no cloud key
  // is configured — never the silent override of a working OpenAI default.
  const prefer = (env.LLM_DEFAULT_PROVIDER || 'openai').toLowerCase();
  const automatic = prefer === 'anthropic'
    ? (anthropic() ?? openai() ?? local())
    : prefer === 'local'
      ? (local() ?? openai() ?? anthropic())
      : (openai() ?? anthropic() ?? local());
  if (automatic) return automatic;
  return emptyRegistry();
}

function emptyRegistry(): ModelRegistry {
  return { provider: 'none', baseUrl: '', apiKey: '', models: { reasoning: '', standard: '', fast: '' }, isLocal: false };
}

export function availableModelProviders(env: NodeJS.ProcessEnv = process.env): Record<Exclude<ModelProviderSelection, 'auto'>, boolean> {
  return { local: Boolean(env.LLM_LOCAL_BASE_URL), openai: Boolean(env.OPENAI_API_KEY), anthropic: Boolean(env.ANTHROPIC_API_KEY) };
}

/* ------------------------------- interface ------------------------------ */

export interface ChatToolDef {
  name: string;
  description: string;
  /** JSON Schema for arguments (z.toJSONSchema output). */
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: LoopMessage[];
  tools: ChatToolDef[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatToolCall {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  toolCalls: ChatToolCall[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
  provider: string;
  /** Provider-reported usage detail; zero when the provider omits the field. */
  tokensCached?: number;
  tokensReasoning?: number;
  tokensTotal?: number;
  usageSource?: 'provider' | 'unavailable';
  pricingSource?: 'configured' | 'built_in' | 'none';
}

/**
 * A fragment of a model turn, delivered while it is still being produced (D-213).
 *
 * Deliberately narrow: text as it is written, and the moment a tool call has
 * been named. Nothing here is authoritative — the completed `ChatResult` is,
 * and it is returned unchanged. A client that misses every delta still gets a
 * correct answer, one that is merely slower to appear. That asymmetry is the
 * point: streaming may never become a second source of truth about what the
 * model said.
 */
export type ChatDelta =
  | { kind: 'text'; text: string }
  /** The model has committed to a tool and a name; arguments may still be arriving. */
  | { kind: 'tool.start'; toolName: string; callId: string };

export interface ToolCallingProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  /**
   * Same request, same result, emitted progressively.
   *
   * OPTIONAL BY DESIGN. `MockProvider`, a self-hosted endpoint with no SSE
   * support, and any provider added later all keep working untouched; the loop
   * checks for the method and falls back to `chat`. Making it required would
   * have forced every implementation to fake a stream, which is how a
   * "streaming" system ends up delivering one chunk at the end — the exact
   * failure this replaces.
   */
  chatStream?(req: ChatRequest, onDelta: (d: ChatDelta) => void): Promise<ChatResult>;
}

/* ------------------------------ SSE reading ----------------------------- */

/**
 * Yield the `data:` payloads of an SSE response, in order.
 *
 * Written by hand rather than pulled in: the whole of the format we need is
 * "lines starting with `data: `, records separated by a blank line", and the
 * one thing that actually matters is that a JSON object split across two TCP
 * reads is reassembled rather than dropped. `decoder.decode(v, {stream:true})`
 * handles a multi-byte character split across the same boundary — which is not
 * hypothetical for Persian text.
 */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Records are blank-line separated; keep the trailing partial in `buf`.
      const records = buf.split(/\r?\n\r?\n/);
      buf = records.pop() ?? '';
      for (const record of records) {
        for (const line of record.split(/\r?\n/)) {
          if (line.startsWith('data:')) yield line.slice(5).trim();
        }
      }
    }
  } finally {
    // A caller that stops early (abort, budget, cancel) must not leave the
    // socket held open.
    await reader.cancel().catch(() => undefined);
  }
}

/* ------------------------------- pricing -------------------------------- */

/** USD per 1M tokens [in, out]; unknown/local models cost 0 (visible as such). */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
};
export function estimateCost(
  model: string, tokensIn: number, tokensOut: number, isLocal: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { costUsd: number; pricingSource: 'configured' | 'built_in' | 'none' } {
  if (isLocal) return { costUsd: 0, pricingSource: 'none' };
  let configured: Record<string, [number, number]> = {};
  try { configured = JSON.parse(env.LLM_PRICE_OVERRIDES_JSON || '{}') as Record<string, [number, number]>; } catch { /* readiness reports invalid JSON separately */ }
  const p = configured[model] ?? PRICES[model];
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { costUsd: 0, pricingSource: 'none' };
  return {
    costUsd: (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000,
    pricingSource: configured[model] ? 'configured' : 'built_in',
  };
}
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number, isLocal: boolean): number {
  return estimateCost(model, tokensIn, tokensOut, isLocal).costUsd;
}

/* --------------------------- anthropic native --------------------------- */

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

function toAnthropicMessages(messages: LoopMessage[]): Array<{ role: 'user' | 'assistant'; content: AnthropicContent[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: AnthropicContent[] }> = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // carried separately
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    } else if (m.role === 'assistant') {
      const content: AnthropicContent[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.callId, name: c.toolName, input: c.args });
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
    } else {
      // tool result → user-turn tool_result block (Anthropic convention)
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
    }
  }
  return out;
}

/**
 * The system prompt as a cacheable content block (D-212).
 *
 * Anthropic's cache hierarchy is tools → system → messages, and a breakpoint
 * covers everything ABOVE it. One breakpoint on the system block therefore
 * caches the tool schemas too — and the tool schemas are the expensive part
 * here: ~30 JSON Schemas resent verbatim on every step of every turn.
 *
 * A single breakpoint is deliberate. Anthropic allows four, but each one is a
 * separate cache entry with its own write cost, and the packet below system
 * (the context) is rebuilt per turn anyway. Paying to cache something that
 * changes is worse than not caching it.
 *
 * Below the model's minimum cacheable length the field is ignored rather than
 * rejected, so this is safe on short prompts.
 */
export function anthropicSystemBlocks(system: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

export class AnthropicToolsProvider implements ToolCallingProvider {
  readonly name = 'anthropic';
  /**
   * `baseUrl` is overridable so this provider can be driven against a real
   * local HTTP server in tests — the same wire-proof pattern the
   * OpenAI-compatible provider already allowed. It also covers a corporate
   * proxy or an Anthropic-compatible gateway, neither of which was reachable
   * while the host was a constant.
   */
  constructor(
    private readonly apiKey: string,
    private readonly isLocal = false,
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const http = llmHttpConfigFromEnv();
    const res = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        system: anthropicSystemBlocks(req.system),
        messages: toAnthropicMessages(req.messages),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      }),
    }, {
      name: 'anthropic',
      signal: req.signal ?? null,
      timeoutMs: http.cloudTimeoutMs,
      maxAttempts: http.cloudMaxAttempts,
    });
    /* No `!res.ok` check: `fetchWithRetry` only returns a successful response.
     * A 429 is now waited out rather than reported, and a terminal failure
     * arrives as a RetryableError carrying the status — which is what turns
     * the owner-facing message from raw provider JSON into a sentence. */
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const text = body.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const toolCalls: ChatToolCall[] = body.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ callId: c.id ?? '', toolName: c.name ?? '', args: c.input ?? {} }));
    const tokensIn = body.usage?.input_tokens ?? 0;
    const tokensOut = body.usage?.output_tokens ?? 0;
    const pricing = estimateCost(req.model, tokensIn, tokensOut, this.isLocal);
    return {
      text, toolCalls, tokensIn, tokensOut, ...pricing, model: req.model, provider: this.name,
      tokensCached: body.usage?.cache_read_input_tokens ?? 0,
      tokensTotal: tokensIn + tokensOut,
      usageSource: body.usage ? 'provider' : 'unavailable',
    };
  }

  async chatStream(req: ChatRequest, onDelta: (d: ChatDelta) => void): Promise<ChatResult> {
    const http = llmHttpConfigFromEnv();
    const res = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        system: anthropicSystemBlocks(req.system),
        messages: toAnthropicMessages(req.messages),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        stream: true,
      }),
    }, { name: 'anthropic', signal: req.signal ?? null, timeoutMs: http.cloudTimeoutMs, maxAttempts: http.cloudMaxAttempts });

    let text = '';
    /* Blocks are addressed by index, and a tool block's arguments arrive as a
     * string split at arbitrary points — `{"da`, `te":"tom`, `orrow"}`. Only
     * the concatenation is valid JSON, so parsing happens at content_block_stop
     * and never before. */
    const blocks = new Map<number, { type: string; callId: string; toolName: string; json: string }>();
    const toolCalls: ChatToolCall[] = [];
    let tokensIn = 0, tokensOut = 0, tokensCached = 0;
    let sawUsage = false;

    for await (const payload of sseData(res)) {
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(payload) as Record<string, unknown>; } catch { continue; }
      const type = String(ev.type ?? '');

      if (type === 'message_start') {
        const u = (ev.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } } | undefined)?.usage;
        if (u) { tokensIn = u.input_tokens ?? 0; tokensCached = u.cache_read_input_tokens ?? 0; sawUsage = true; }
      } else if (type === 'content_block_start') {
        const idx = Number(ev.index ?? 0);
        const cb = ev.content_block as { type?: string; id?: string; name?: string } | undefined;
        blocks.set(idx, { type: cb?.type ?? 'text', callId: cb?.id ?? '', toolName: cb?.name ?? '', json: '' });
        if (cb?.type === 'tool_use') onDelta({ kind: 'tool.start', toolName: cb.name ?? '', callId: cb.id ?? '' });
      } else if (type === 'content_block_delta') {
        const idx = Number(ev.index ?? 0);
        const d = ev.delta as { type?: string; text?: string; partial_json?: string } | undefined;
        if (d?.type === 'text_delta' && d.text) { text += d.text; onDelta({ kind: 'text', text: d.text }); }
        if (d?.type === 'input_json_delta') {
          const b = blocks.get(idx);
          if (b) b.json += d.partial_json ?? '';
        }
      } else if (type === 'content_block_stop') {
        const b = blocks.get(Number(ev.index ?? 0));
        if (b?.type === 'tool_use') {
          let args: Record<string, unknown> = {};
          // An empty argument block is `{}` in intent but '' on the wire.
          try { args = JSON.parse(b.json || '{}') as Record<string, unknown>; } catch { args = {}; }
          toolCalls.push({ callId: b.callId, toolName: b.toolName, args });
        }
      } else if (type === 'message_delta') {
        const u = ev.usage as { output_tokens?: number } | undefined;
        if (u?.output_tokens != null) { tokensOut = u.output_tokens; sawUsage = true; }
      }
    }

    const pricing = estimateCost(req.model, tokensIn, tokensOut, this.isLocal);
    return {
      text, toolCalls, tokensIn, tokensOut, ...pricing, model: req.model, provider: this.name,
      tokensCached, tokensTotal: tokensIn + tokensOut,
      usageSource: sawUsage ? 'provider' : 'unavailable',
    };
  }
}

/* --------------------- openai-compatible (incl. local) ------------------ */

function toOpenAiMessages(system: string, messages: LoopMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.callId, type: 'function', function: { name: c.toolName, arguments: JSON.stringify(c.args) } }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
}

export class OpenAICompatibleToolsProvider implements ToolCallingProvider {
  readonly name: string;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly isLocal: boolean,
  ) {
    this.name = isLocal ? 'openai-compatible-local' : 'openai-compatible';
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const http = llmHttpConfigFromEnv();
    const timeoutMs = this.isLocal ? http.localTimeoutMs : http.cloudTimeoutMs;
    const maxAttempts = this.isLocal ? http.localMaxAttempts : http.cloudMaxAttempts;

    const run = async (): Promise<ChatResult> => {
      const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0.2,
          messages: toOpenAiMessages(req.system, req.messages),
          tools: req.tools.length
            ? req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
            : undefined,
        }),
      }, {
        name: this.name,
        signal: req.signal ?? null,
        timeoutMs,
        maxAttempts,
      });
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const msg = body.choices?.[0]?.message;
      const toolCalls: ChatToolCall[] = (msg?.tool_calls ?? []).map((c, i) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>; } catch { args = {}; }
        return { callId: c.id ?? `call_${i}`, toolName: c.function?.name ?? '', args };
      });
      const tokensIn = body.usage?.prompt_tokens ?? 0;
      const tokensOut = body.usage?.completion_tokens ?? 0;
      const pricing = estimateCost(req.model, tokensIn, tokensOut, this.isLocal);
      return {
        text: msg?.content ?? '', toolCalls, tokensIn, tokensOut, ...pricing, model: req.model, provider: this.name,
        tokensCached: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        tokensReasoning: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        tokensTotal: body.usage?.total_tokens ?? tokensIn + tokensOut,
        usageSource: body.usage ? 'provider' : 'unavailable',
      };
    };

    // Serialise local calls so a timed-out client cannot pile a second
    // request onto Ollama's single parallel slot while the first still runs.
    if (this.isLocal) {
      return withLocalLlmSlot(http.localMaxConcurrent, run, req.signal ?? null);
    }
    return run();
  }

  async chatStream(req: ChatRequest, onDelta: (d: ChatDelta) => void): Promise<ChatResult> {
    const http = llmHttpConfigFromEnv();
    const timeoutMs = this.isLocal ? http.localTimeoutMs : http.cloudTimeoutMs;
    const maxAttempts = this.isLocal ? http.localMaxAttempts : http.cloudMaxAttempts;

    const run = async (): Promise<ChatResult> => {
      const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0.2,
          messages: toOpenAiMessages(req.system, req.messages),
          tools: req.tools.length
            ? req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
            : undefined,
          stream: true,
          /* Without this the usage block is simply absent from a streamed
           * response, every turn records 0 tokens, and `maxCostUsd` stops
           * being enforceable. Ollama and vLLM ignore the field harmlessly. */
          stream_options: { include_usage: true },
        }),
      }, { name: this.name, signal: req.signal ?? null, timeoutMs, maxAttempts });

      let text = '';
      /* Tool calls stream as fragments addressed by `index`. `id` and `name`
       * appear once, on the first fragment; `arguments` is a string cut at
       * arbitrary points and must be APPENDED. Assigning instead of appending
       * is the classic bug here: the call ends up with only its last fragment,
       * which parses as {} and silently drops every argument the owner gave. */
      const partial = new Map<number, { callId: string; toolName: string; args: string; announced: boolean }>();
      let tokensIn = 0, tokensOut = 0, tokensTotal = 0, tokensCached = 0, tokensReasoning = 0;
      let sawUsage = false;

      for await (const payload of sseData(res)) {
        if (payload === '[DONE]') break;
        let ev: {
          choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
        };
        try { ev = JSON.parse(payload) as typeof ev; } catch { continue; }

        if (ev.usage) {
          tokensIn = ev.usage.prompt_tokens ?? tokensIn;
          tokensOut = ev.usage.completion_tokens ?? tokensOut;
          tokensTotal = ev.usage.total_tokens ?? tokensTotal;
          tokensCached = ev.usage.prompt_tokens_details?.cached_tokens ?? tokensCached;
          tokensReasoning = ev.usage.completion_tokens_details?.reasoning_tokens ?? tokensReasoning;
          sawUsage = true;
        }

        const delta = ev.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) { text += delta.content; onDelta({ kind: 'text', text: delta.content }); }
        for (const [i, tc] of (delta.tool_calls ?? []).entries()) {
          const idx = tc.index ?? i;
          const cur = partial.get(idx) ?? { callId: '', toolName: '', args: '', announced: false };
          if (tc.id) cur.callId = tc.id;
          if (tc.function?.name) cur.toolName = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          // Announce once, as soon as there is a name worth announcing.
          if (!cur.announced && cur.toolName) {
            cur.announced = true;
            onDelta({ kind: 'tool.start', toolName: cur.toolName, callId: cur.callId || `call_${idx}` });
          }
          partial.set(idx, cur);
        }
      }

      const toolCalls: ChatToolCall[] = [...partial.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([idx, p]) => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(p.args || '{}') as Record<string, unknown>; } catch { args = {}; }
          return { callId: p.callId || `call_${idx}`, toolName: p.toolName, args };
        })
        .filter((c) => c.toolName);

      const pricing = estimateCost(req.model, tokensIn, tokensOut, this.isLocal);
      return {
        text, toolCalls, tokensIn, tokensOut, ...pricing, model: req.model, provider: this.name,
        tokensCached, tokensReasoning,
        tokensTotal: tokensTotal || tokensIn + tokensOut,
        usageSource: sawUsage ? 'provider' : 'unavailable',
      };
    };

    if (this.isLocal) {
      return withLocalLlmSlot(http.localMaxConcurrent, run, req.signal ?? null);
    }
    return run();
  }
}

/* ------------------------------ construction ---------------------------- */

export function toolCallingProviderFor(reg: ModelRegistry): ToolCallingProvider | null {
  if (reg.provider === 'anthropic') return new AnthropicToolsProvider(reg.apiKey);
  if (reg.provider === 'openai-compatible') return new OpenAICompatibleToolsProvider(reg.baseUrl, reg.apiKey, reg.isLocal);
  return null;
}

/** Live health probe for the configured provider (mandate: status visible). */
export async function probeModelProvider(reg: ModelRegistry, timeoutMs = 8000): Promise<{ ok: boolean; detail: string }> {
  if (reg.provider === 'none') return { ok: false, detail: 'no model provider configured (degraded mode)' };
  const provider = toolCallingProviderFor(reg);
  if (!provider) return { ok: false, detail: 'provider construction failed' };
  try {
    const res = await provider.chat({
      system: 'Reply with the single word: ok',
      messages: [{ role: 'user', content: 'health check', toolCalls: [], toolCallId: '', toolName: '' }],
      tools: [],
      model: reg.models.fast,
      maxTokens: 8,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: true, detail: `${provider.name}/${reg.models.fast} responded (${res.tokensOut} tokens out)` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'probe failed' };
  }
}
