/**
 * LLM Router — shared reasoning infrastructure for agents.
 *
 * Provider abstraction (local OpenAI-compatible / Anthropic / OpenAI /
 * deterministic Mock), model
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
import { fetchWithRetry } from './resilience.js';
import { llmHttpConfigFromEnv } from './config.js';
import { withLocalLlmSlot } from './concurrency.js';

export type ProviderName = 'local' | 'anthropic' | 'openai' | 'mock';

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
  usageSource: 'provider' | 'estimated';
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
    return { text, model: req.model, provider: this.name, tokensIn, tokensOut, costUsd: estimateCost(req.model, tokensIn, tokensOut), usageSource: body.usage ? 'provider' : 'estimated' };
  }
}

export class OpenAIProvider implements LlmProvider {
  readonly name: 'local' | 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly isLocal = false,
  ) {
    this.name = isLocal ? 'local' : 'openai';
  }
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const http = llmHttpConfigFromEnv();
    const timeoutMs = this.isLocal ? http.localTimeoutMs : http.cloudTimeoutMs;
    const maxAttempts = this.isLocal ? http.localMaxAttempts : http.cloudMaxAttempts;
    const run = async (): Promise<LlmCompletionResult> => {
      const res = await fetchWithRetry(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
      }, {
        name: this.name,
        timeoutMs,
        maxAttempts,
      });
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = body.choices?.[0]?.message?.content ?? '';
      const tokensIn = body.usage?.prompt_tokens ?? approxTokens(req.system + req.prompt);
      const tokensOut = body.usage?.completion_tokens ?? approxTokens(text);
      return {
        text,
        model: req.model,
        provider: this.name,
        tokensIn,
        tokensOut,
        costUsd: this.isLocal ? 0 : estimateCost(req.model, tokensIn, tokensOut),
        usageSource: body.usage ? 'provider' : 'estimated',
      };
    };
    if (this.isLocal) return withLocalLlmSlot(http.localMaxConcurrent, run);
    return run();
  }
}

/** Deterministic provider: returns nothing, forcing the caller's fallback. */
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;
  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return { text: '', model: req.model, provider: this.name, tokensIn: 0, tokensOut: 0, costUsd: 0, usageSource: 'estimated' };
  }
}

export interface LlmRouterConfig {
  localBaseUrl?: string;
  localApiKey?: string;
  localModel?: string;
  localFastModel?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultProvider?: 'anthropic' | 'openai';
}

/** Default model per provider, selectable per task type. */
const MODELS = {
  anthropic: { default: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5' },
  openai: { default: 'gpt-4.1', fast: 'gpt-4.1-mini' },
} as const;

const DEFAULT_LOCAL_MODEL = 'llama3.1';

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
  private readonly models: { default: string; fast: string };

  constructor(cfg: LlmRouterConfig) {
    const wantOpenAi = cfg.defaultProvider === 'openai';
    // Prefer the configured default cloud provider. Local is a fallback when
    // no cloud key is present — never an automatic override of OpenAI/Anthropic.
    if (wantOpenAi && cfg.openaiApiKey) {
      this.provider = new OpenAIProvider(cfg.openaiApiKey);
      this.models = MODELS.openai;
    } else if (!wantOpenAi && cfg.anthropicApiKey) {
      this.provider = new AnthropicProvider(cfg.anthropicApiKey);
      this.models = MODELS.anthropic;
    } else if (cfg.openaiApiKey) {
      this.provider = new OpenAIProvider(cfg.openaiApiKey);
      this.models = MODELS.openai;
    } else if (cfg.anthropicApiKey) {
      this.provider = new AnthropicProvider(cfg.anthropicApiKey);
      this.models = MODELS.anthropic;
    } else if (cfg.localBaseUrl) {
      this.provider = new OpenAIProvider(cfg.localApiKey || 'local', cfg.localBaseUrl, true);
      const model = cfg.localModel || DEFAULT_LOCAL_MODEL;
      this.models = { default: model, fast: cfg.localFastModel || model };
    } else {
      this.provider = new MockProvider();
      this.models = { default: 'mock', fast: 'mock' };
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
    return fast ? this.models.fast : this.models.default;
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
    let usageSource: 'provider' | 'estimated' = 'estimated';
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
          usageSource = res.usageSource;
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
      usageSource,
      pricingSource: this.providerName === 'local' || this.providerName === 'mock' ? 'none' : 'built_in',
      createdAt: nowIso(),
    };
    return { data, trace };
  }
}

/** Build a router from standard env (LLM_* / *_API_KEY). */
export function llmRouterFromEnv(env: NodeJS.ProcessEnv = process.env): LlmRouter {
  const mode = env.LLM_PROVIDER_MODE;
  const allowLocal = mode !== 'openai' && mode !== 'anthropic';
  const allowOpenAi = mode !== 'local' && mode !== 'anthropic';
  const allowAnthropic = mode !== 'local' && mode !== 'openai';
  const defaultProvider = (
    mode === 'openai' || mode === 'anthropic'
      ? mode
      : (env.LLM_DEFAULT_PROVIDER as 'anthropic' | 'openai') || 'openai'
  );
  return new LlmRouter({
    localBaseUrl: allowLocal ? env.LLM_LOCAL_BASE_URL || undefined : undefined,
    localApiKey: env.LLM_LOCAL_API_KEY || undefined,
    localModel: env.LLM_MODEL_STANDARD || env.LLM_LOCAL_MODEL || undefined,
    localFastModel: env.LLM_MODEL_FAST || env.LLM_LOCAL_MODEL_FAST || undefined,
    anthropicApiKey: allowAnthropic ? env.ANTHROPIC_API_KEY || undefined : undefined,
    openaiApiKey: allowOpenAi ? env.OPENAI_API_KEY || undefined : undefined,
    defaultProvider,
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
    defaultProvider: router.activeProvider === 'local' ? 'local' : (env.LLM_DEFAULT_PROVIDER || 'openai'),
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
    allowedProviders: (env.LLM_ALLOWED_PROVIDERS || 'local,anthropic,openai').split(',').map((s) => s.trim()).filter(Boolean),
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
    tokensCached: 0,
    tokensReasoning: 0,
    tokensTotal: trace.tokensIn + trace.tokensOut,
    costUsd: trace.costUsd,
    usageSource: trace.usageSource,
    pricingSource: trace.pricingSource,
    runId: null,
    usedFallback: trace.usedFallback,
    traceId: trace.traceId,
    createdAt: nowIso(),
  };
}

export function buildBudgetEvent(args: Omit<LlmBudgetEvent, 'budgetEventId' | 'createdAt'>): LlmBudgetEvent {
  return { budgetEventId: genId('budget'), createdAt: nowIso(), ...args };
}

export { promptFor, listPrompts, agentPrompts, type VersionedPrompt, type AgentPrompt } from './prompts.js';

// D-211 — retry/backoff and owner-readable provider errors.
export * from './resilience.js';
export * from './config.js';
export * from './concurrency.js';
