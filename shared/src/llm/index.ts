/**
 * LLM Router — shared reasoning infrastructure for agents.
 *
 * Provider abstraction (Anthropic / OpenAI / deterministic Mock), model
 * selection by task type, retry, cost/token tracking, and — most importantly —
 * **schema-validated structured output**. Agents reason through
 * `generateStructured(schema, { fallback })`: the validated result is the only
 * thing returned, so no raw, unvalidated LLM text can ever mutate system state.
 * When no provider key is configured (local/test), the deterministic fallback
 * is used and the trace is marked accordingly.
 */
import type { ZodType } from 'zod';
import { genId, nowIso } from '../utils/index.js';
import type { LlmTrace } from '../schemas/capability.js';

export type ProviderName = 'anthropic' | 'openai' | 'mock';

export interface LlmCompletionRequest {
  system: string;
  prompt: string;
  model: string;
  maxTokens?: number;
}

export interface LlmCompletionResult {
  text: string;
  model: string;
  provider: ProviderName;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface LlmProvider {
  readonly name: ProviderName;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/** Rough cost estimate (USD) per 1K tokens — used for budgeting/trace, not billing. */
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  default: { in: 0.003, out: 0.015 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const c = COST_PER_1K[model] ?? COST_PER_1K.default!;
  return (tokensIn / 1000) * c.in + (tokensOut / 1000) * c.out;
}

/** Approximate token count (4 chars/token heuristic) for offline cost tracking. */
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  constructor(private readonly apiKey: string) {}
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = body.content?.map((c) => c.text ?? '').join('') ?? '';
    const tokensIn = body.usage?.input_tokens ?? approxTokens(req.system + req.prompt);
    const tokensOut = body.usage?.output_tokens ?? approxTokens(text);
    return { text, model: req.model, provider: this.name, tokensIn, tokensOut, costUsd: estimateCost(req.model, tokensIn, tokensOut) };
  }
}

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai' as const;
  constructor(private readonly apiKey: string) {}
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = body.choices?.[0]?.message?.content ?? '';
    const tokensIn = body.usage?.prompt_tokens ?? approxTokens(req.system + req.prompt);
    const tokensOut = body.usage?.completion_tokens ?? approxTokens(text);
    return { text, model: req.model, provider: this.name, tokensIn, tokensOut, costUsd: estimateCost(req.model, tokensIn, tokensOut) };
  }
}

/** Deterministic provider: returns nothing, forcing the caller's fallback. */
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return { text: '', model: req.model, provider: this.name, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
}

export interface LlmRouterConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultProvider?: 'anthropic' | 'openai';
}

/** Default model per provider, selectable per task type. */
const MODELS = {
  anthropic: { default: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5' },
  openai: { default: 'gpt-4.1', fast: 'gpt-4.1-mini' },
} as const;

export interface GenerateStructuredOpts<T> {
  agentId: string;
  taskType: string;
  prompt: string;
  system?: string;
  taskId?: string | null;
  /** Deterministic, schema-valid result used when no provider or on invalid output. */
  fallback: () => T;
  maxAttempts?: number;
  fast?: boolean;
  promptVersion?: string;
  /** Phase AG.3 — completion token budget for this call. Defaults to 1024
   *  (the historical default) when unset. Tasks that ask the model to
   *  synthesize over substantial retrieved content (e.g. research grounded
   *  on several search results) need more headroom, or the completion gets
   *  silently truncated into invalid JSON and looks identical to "the LLM
   *  isn't configured" from the outside. */
  maxTokens?: number;
  /**
   * Force deterministic fallback without calling any provider. The orchestrator
   * sets this when safe mode + LLM_SAFE_MODE_FALLBACK is on, or when a budget
   * limit has been reached. The trace is still recorded (usedFallback=true).
   */
  forceFallback?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  trace: LlmTrace;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export class LlmRouter {
  private readonly provider: LlmProvider;
  private readonly providerName: ProviderName;

  constructor(cfg: LlmRouterConfig) {
    const wantOpenAi = cfg.defaultProvider === 'openai';
    if (wantOpenAi && cfg.openaiApiKey) {
      this.provider = new OpenAIProvider(cfg.openaiApiKey);
    } else if (cfg.anthropicApiKey) {
      this.provider = new AnthropicProvider(cfg.anthropicApiKey);
    } else if (cfg.openaiApiKey) {
      this.provider = new OpenAIProvider(cfg.openaiApiKey);
    } else {
      this.provider = new MockProvider();
    }
    this.providerName = this.provider.name;
  }

  get activeProvider(): ProviderName {
    return this.providerName;
  }

  /** Liveness probe: confirms a configured provider actually responds. */
  async healthCheck(): Promise<{ provider: ProviderName; configured: boolean; reachable: boolean; error?: string }> {
    if (this.providerName === 'mock') return { provider: 'mock', configured: false, reachable: false };
    try {
      const res = await this.provider.complete({ system: 'ping', prompt: 'Reply with the single word: ok', model: this.modelFor(true), maxTokens: 5 });
      return { provider: this.providerName, configured: true, reachable: res.text.length >= 0 };
    } catch (e) {
      return { provider: this.providerName, configured: true, reachable: false, error: e instanceof Error ? e.message : 'unreachable' };
    }
  }

  private modelFor(fast?: boolean): string {
    if (this.providerName === 'openai') return fast ? MODELS.openai.fast : MODELS.openai.default;
    if (this.providerName === 'anthropic') return fast ? MODELS.anthropic.fast : MODELS.anthropic.default;
    return 'mock';
  }

  /**
   * Reason into a Zod-validated structure. Returns the validated data plus a
   * trace. The fallback is itself schema-validated, so the returned data is
   * always safe to mutate state with.
   */
  async generateStructured<T>(schema: ZodType<T>, opts: GenerateStructuredOpts<T>): Promise<StructuredResult<T>> {
    const model = this.modelFor(opts.fast);
    const system = opts.system ?? 'You are a precise planning component. Respond ONLY with valid JSON matching the requested schema.';
    let attempts = 0;
    let completion = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let data: T | null = null;
    let usedFallback = false;
    // Phase AG.3 — the specific reason the last attempt didn't produce
    // validated data. Previously this was thrown away in a bare `catch {}`,
    // so a real provider error (bad key, rate limit, 5xx, truncated/invalid
    // JSON) was indistinguishable from "no provider configured" once the
    // caller only had `usedFallback: true` to go on.
    let lastError: string | null = null;

    if (this.providerName !== 'mock' && !opts.forceFallback) {
      const max = opts.maxAttempts ?? 2;
      // Phase AG.5 — the specific corrective note appended to the prompt on
      // a retry, once a prior attempt failed. Previously every retry
      // attempt sent the IDENTICAL prompt again, so a model that
      // misunderstood the required shape once would reliably misunderstand
      // it again — attempt 2 failed with the exact same complaint as
      // attempt 1. Now the model sees exactly what was wrong and where.
      let correctiveNote = '';
      while (attempts < max && data === null) {
        attempts++;
        try {
          const res = await this.provider.complete({ system, prompt: opts.prompt + correctiveNote, model, maxTokens: opts.maxTokens });
          completion = res.text;
          tokensIn += res.tokensIn;
          tokensOut += res.tokensOut;
          costUsd += res.costUsd;
          const parsed = schema.safeParse(extractJson(res.text));
          if (parsed.success) { data = parsed.data; lastError = null; }
          else {
            // Phase AG.5 — surface the failing field PATH, not just the
            // generic Zod message ("expected string, received undefined"
            // alone doesn't say which field). `issues[0]` is the first of
            // possibly several; the path is the actionable part for both
            // the corrective retry and for whoever reads errorDetail later.
            const issue = parsed.error.issues[0];
            const path = issue && issue.path.length > 0 ? issue.path.join('.') : '(root)';
            const issueMessage = issue?.message ?? 'validation failed';
            lastError = `provider responded but output did not match the expected schema (attempt ${attempts}) at "${path}": ${issueMessage}`;
            correctiveNote = `\n\nYour previous response was invalid JSON for the required schema — the field at "${path}" was wrong or missing: ${issueMessage}. Respond again with ONLY corrected, complete JSON matching the schema exactly. Every required field must be present; if a narrative field is genuinely unknown, use a short honest placeholder string instead of omitting the key.`;
          }
        } catch (e) {
          lastError = `${this.providerName} call failed (attempt ${attempts}): ${e instanceof Error ? e.message : 'request failed'}`;
        }
      }
    }

    if (data === null) {
      // Validate the fallback too — nothing unvalidated ever escapes this method.
      data = schema.parse(opts.fallback());
      usedFallback = true;
    }

    const trace: LlmTrace = {
      traceId: genId('llm'),
      agentId: opts.agentId,
      taskId: opts.taskId ?? null,
      taskType: opts.taskType,
      promptVersion: opts.promptVersion ?? 'v0',
      provider: this.providerName,
      model,
      system,
      prompt: opts.prompt,
      completion,
      valid: true,
      usedFallback,
      errorDetail: usedFallback ? lastError : null,
      attempts: attempts || 0,
      tokensIn,
      tokensOut,
      costUsd,
      createdAt: nowIso(),
    };
    return { data, trace };
  }
}

/** Build a router from standard env (LLM_* / *_API_KEY). */
export function llmRouterFromEnv(env: NodeJS.ProcessEnv = process.env): LlmRouter {
  return new LlmRouter({
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    defaultProvider: (env.LLM_DEFAULT_PROVIDER as 'anthropic' | 'openai') || 'anthropic',
  });
}

export interface LlmStatus {
  provider: ProviderName;
  configured: boolean; // a real provider key is set (not mock)
  mode: 'real' | 'fallback';
  defaultProvider: string;
}

/** Report whether reasoning is real or deterministic fallback (no live call). */
export function llmStatusFromEnv(env: NodeJS.ProcessEnv = process.env): LlmStatus {
  const router = llmRouterFromEnv(env);
  const configured = router.activeProvider !== 'mock';
  return {
    provider: router.activeProvider,
    configured,
    mode: configured ? 'real' : 'fallback',
    defaultProvider: env.LLM_DEFAULT_PROVIDER || 'anthropic',
  };
}

/* -------------------- Phase 13: budget + cost helpers -------------------- */

import type { LlmCostRecord, LlmBudgetEvent } from '../schemas/intelligence.js';

/** Provider/budget governance config from env. */
export interface LlmGovernanceConfig {
  allowedProviders: string[];
  maxCostPerTaskUsd: number;
  maxTokensPerTask: number;
  dailyCostLimitUsd: number;
  safeModeFallback: boolean;
}

export function llmGovernanceFromEnv(env: NodeJS.ProcessEnv = process.env): LlmGovernanceConfig {
  return {
    allowedProviders: (env.LLM_ALLOWED_PROVIDERS || 'anthropic,openai').split(',').map((s) => s.trim()).filter(Boolean),
    maxCostPerTaskUsd: Number(env.LLM_MAX_COST_PER_TASK_USD ?? 0.5),
    maxTokensPerTask: Number(env.LLM_MAX_TOKENS_PER_TASK ?? 120000),
    dailyCostLimitUsd: Number(env.LLM_DAILY_COST_LIMIT_USD ?? 20),
    safeModeFallback: (env.LLM_SAFE_MODE_FALLBACK ?? 'true') !== 'false',
  };
}

/** Turn a trace into a cost record (one per LLM call). */
export function buildLlmCostRecord(trace: LlmTrace): LlmCostRecord {
  return {
    recordId: genId('cost'),
    taskId: trace.taskId,
    agentId: trace.agentId,
    taskType: trace.taskType,
    provider: trace.provider,
    model: trace.model,
    tokensIn: trace.tokensIn,
    tokensOut: trace.tokensOut,
    costUsd: trace.costUsd,
    usedFallback: trace.usedFallback,
    traceId: trace.traceId,
    createdAt: nowIso(),
  };
}

export function buildBudgetEvent(args: Omit<LlmBudgetEvent, 'budgetEventId' | 'createdAt'>): LlmBudgetEvent {
  return { budgetEventId: genId('budget'), createdAt: nowIso(), ...args };
}

export { promptFor, listPrompts, agentPrompts, type VersionedPrompt, type AgentPrompt } from './prompts.js';
