/**
 * LLM HTTP / concurrency knobs from env.
 *
 * Why these exist
 * ---------------
 * Ollama on a small host often needs several minutes for a cold 4B load +
 * first token. Node's undici defaults `headersTimeout` to 300_000 ms (5m).
 * When that fires, the error is a network TimeoutError — NOT an AbortError —
 * so the D-211 retry loop treated it as "retryable socket drop" and fired the
 * same prompt again. With `OLLAMA_NUM_PARALLEL=1` that second in-flight call
 * queues behind the first (still running on the GPU/CPU), and the stampede
 * locks the only slot.
 *
 * These env vars keep the behaviour tunable in Dokploy without another code
 * change: raise the HTTP timeout above real inference time, cap retries, and
 * serialise local calls to match the single Ollama slot.
 */

export interface LlmHttpConfig {
  /** Per-request wall-clock for cloud providers (AbortSignal + undici). */
  cloudTimeoutMs: number;
  /** Per-request wall-clock for local/OpenAI-compatible self-hosted. */
  localTimeoutMs: number;
  /** Total attempts for cloud (1 + retries). */
  cloudMaxAttempts: number;
  /** Total attempts for local — keep low; timeouts must not stampede. */
  localMaxAttempts: number;
  /** Max concurrent in-flight calls to the local endpoint. */
  localMaxConcurrent: number;
  /** Jarvis / agent-loop wall clock when the active provider is local. */
  localTurnTimeoutMs: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function llmHttpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmHttpConfig {
  return {
    // Cloud: two minutes is plenty for OpenAI/Anthropic; override if needed.
    cloudTimeoutMs: positiveInt(env.LLM_HTTP_TIMEOUT_MS, 120_000),
    // Local: ten minutes headroom for cold load + long tool-call prompts.
    // Must exceed undici's former 5m default or HeadersTimeout returns first.
    localTimeoutMs: positiveInt(env.LLM_LOCAL_HTTP_TIMEOUT_MS, 600_000),
    cloudMaxAttempts: positiveInt(env.LLM_HTTP_MAX_ATTEMPTS, 4),
    // Local default: one shot. A timeout almost always means the model is
    // still working — retrying doubles load on the only parallel slot.
    localMaxAttempts: positiveInt(env.LLM_LOCAL_HTTP_MAX_ATTEMPTS, 1),
    localMaxConcurrent: positiveInt(env.LLM_LOCAL_MAX_CONCURRENT, 1),
    localTurnTimeoutMs: positiveInt(env.LLM_LOCAL_TURN_TIMEOUT_MS, 600_000),
  };
}
