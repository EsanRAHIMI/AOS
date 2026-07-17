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

/* ----------------------------- model registry --------------------------- */

export type ModelTier = 'reasoning' | 'standard' | 'fast';

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
export function modelRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): ModelRegistry {
  const tierOverrides = (base: Record<ModelTier, string>): Record<ModelTier, string> => ({
    reasoning: env.LLM_MODEL_REASONING || base.reasoning,
    standard: env.LLM_MODEL_STANDARD || base.standard,
    fast: env.LLM_MODEL_FAST || base.fast,
  });
  if (env.LLM_LOCAL_BASE_URL) {
    const local = env.LLM_LOCAL_MODEL || 'llama3.1';
    return {
      provider: 'openai-compatible',
      baseUrl: env.LLM_LOCAL_BASE_URL.replace(/\/$/, ''),
      apiKey: env.LLM_LOCAL_API_KEY || 'local',
      models: tierOverrides({ reasoning: local, standard: local, fast: env.LLM_LOCAL_MODEL_FAST || local }),
      isLocal: true,
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: env.ANTHROPIC_API_KEY, models: tierOverrides(DEFAULT_MODELS.anthropic as Record<ModelTier, string>), isLocal: false };
  }
  if (env.OPENAI_API_KEY) {
    return { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY, models: tierOverrides(DEFAULT_MODELS['openai-compatible'] as Record<ModelTier, string>), isLocal: false };
  }
  return { provider: 'none', baseUrl: '', apiKey: '', models: { reasoning: '', standard: '', fast: '' }, isLocal: false };
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
}

export interface ToolCallingProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

/* ------------------------------- pricing -------------------------------- */

/** USD per 1M tokens [in, out]; unknown/local models cost 0 (visible as such). */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
};
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number, isLocal: boolean): number {
  if (isLocal) return 0;
  const p = PRICES[model];
  if (!p) return 0;
  return (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000;
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

export class AnthropicToolsProvider implements ToolCallingProvider {
  readonly name = 'anthropic';
  constructor(private readonly apiKey: string, private readonly isLocal = false) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const toolCalls: ChatToolCall[] = body.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ callId: c.id ?? '', toolName: c.name ?? '', args: c.input ?? {} }));
    const tokensIn = body.usage?.input_tokens ?? 0;
    const tokensOut = body.usage?.output_tokens ?? 0;
    return { text, toolCalls, tokensIn, tokensOut, costUsd: estimateCostUsd(req.model, tokensIn, tokensOut, this.isLocal), model: req.model, provider: this.name };
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
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        messages: toOpenAiMessages(req.system, req.messages),
        tools: req.tools.length
          ? req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
          : undefined,
      }),
    });
    if (!res.ok) throw new Error(`openai-compatible ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = body.choices?.[0]?.message;
    const toolCalls: ChatToolCall[] = (msg?.tool_calls ?? []).map((c, i) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>; } catch { args = {}; }
      return { callId: c.id ?? `call_${i}`, toolName: c.function?.name ?? '', args };
    });
    const tokensIn = body.usage?.prompt_tokens ?? 0;
    const tokensOut = body.usage?.completion_tokens ?? 0;
    return { text: msg?.content ?? '', toolCalls, tokensIn, tokensOut, costUsd: estimateCostUsd(req.model, tokensIn, tokensOut, this.isLocal), model: req.model, provider: this.name };
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
