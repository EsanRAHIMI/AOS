/**
 * Provider resilience — surviving a rate limit instead of reporting one
 * (D-211), without stampeding a single-slot local model.
 *
 * THE FAILURE THIS REPLACES
 * -------------------------
 * The owner asked Jarvis to schedule something and got back:
 *
 *   stopped: model_error — openai-compatible 429: { "error": { "message":
 *   "Rate limit reached for gpt-4.1 … Please try again in 11.242s. …
 *
 * Two separate faults in one line.
 *
 * First, the provider told us exactly how long to wait and we ignored it. A
 * 429 with a `Retry-After` is not a failure — it is flow control. Treating it
 * as terminal turns a recoverable eleven-second pause into a dead turn, and
 * because the owner then repeats themselves, into MORE load on the same
 * limit. The system was converting backpressure into a stampede.
 *
 * Second, the raw provider JSON reached the owner. It names the organisation
 * id, the model, the exact token accounting and a support URL. None of that
 * is actionable by the person who asked to book a gym session, and the org id
 * is not something to print in a UI. An error the owner cannot act on should
 * say what it means and what happens next, and nothing else.
 *
 * LOCAL / OLLAMA ADDENDUM
 * -----------------------
 * Undici's default `headersTimeout` is 300_000 ms. When a cold local model
 * takes longer, the client throws a TimeoutError (NOT AbortError). The old
 * loop treated that like a dropped socket and retried immediately-ish —
 * while Ollama was still serving the first request on its only parallel
 * slot. Timeouts are therefore never retried, and local callers pass
 * `maxAttempts: 1` plus a concurrency gate (see concurrency.ts).
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * No retry on 4xx other than 429/408. A 400 means the request is wrong and
 * will be wrong again; retrying it burns the very budget that is scarce. No
 * retry on an aborted or timed-out request either — cancellation is the
 * owner's decision, and a timeout almost always means the upstream is still
 * working on the first call.
 */

import { Agent, type Dispatcher } from 'undici';

/** How many attempts in total (1 original + N retries) when the caller does not override. */
export const MAX_ATTEMPTS = 4;
/** Never sleep longer than this for a single retry, whatever the hint says. */
export const MAX_BACKOFF_MS = 20_000;
/**
 * Base for exponential backoff when the provider gives no hint.
 * attempt 1 → ~2s, 2 → ~4s, 3 → ~8s (plus jitter), capped by MAX_BACKOFF_MS.
 */
const BASE_BACKOFF_MS = 2_000;

export interface RetryableError extends Error {
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** Milliseconds the provider asked us to wait. */
  retryAfterMs?: number;
  /** The raw body, kept for logs — never for the owner. */
  detail?: string;
}

/**
 * How long the provider asked us to wait.
 *
 * Checks the `Retry-After` header first (the standard), then the phrasing
 * OpenAI puts in the body — "Please try again in 11.242s" / "in 250ms".
 * Parsing the body is not elegant, but the header is frequently absent on
 * token-per-minute limits and the body hint is the only number available; a
 * blind exponential backoff would sleep either far too long or too short.
 */
export function parseRetryAfterMs(headers: Headers | null, body: string): number | null {
  const header = headers?.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(header);              // HTTP-date form
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const ms = /try again in\s+([\d.]+)\s*ms/i.exec(body);
  if (ms) return Math.max(0, Number(ms[1]));
  const s = /try again in\s+([\d.]+)\s*s/i.exec(body);
  if (s) return Math.max(0, Number(s[1]) * 1000);
  return null;
}

/** Is this worth trying again, or will it fail identically? */
export function isRetryable(status: number): boolean {
  // 408 request timeout, 429 rate limited, 5xx upstream trouble.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Client-side / undici timeouts must NOT be retried — especially against a
 * single-slot local model where the first call is usually still running.
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string }; message?: string };
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  const code = e.code ?? e.cause?.code;
  if (
    code === 'UND_ERR_HEADERS_TIMEOUT'
    || code === 'UND_ERR_BODY_TIMEOUT'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
    || code === 'ABORT_ERR'
  ) return true;
  const msg = `${e.message ?? ''} ${e.cause?.name ?? ''}`;
  return /headers?\s*timeout|body\s*timeout|connect\s*timeout|the operation was aborted/i.test(msg);
}

/**
 * Wait time for an attempt.
 *
 * The provider's own hint wins when it gives one — it knows when the window
 * resets and we do not. Jitter is added regardless: several turns hitting the
 * same limit would otherwise wake at the same instant and collide again,
 * which is the classic way a backoff makes a rate limit worse rather than
 * better.
 */
export function backoffMs(attempt: number, hintMs: number | null): number {
  const base = hintMs ?? BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * 250;
  return Math.min(MAX_BACKOFF_MS, base + jitter);
}

/**
 * Turn a provider failure into a sentence for the owner.
 *
 * Never includes the raw body: it carries the organisation id, the model
 * name and internal token accounting. The owner gets what happened, and
 * whether it is worth trying again. `detail` keeps the original for the logs
 * and the run record, which is where it belongs.
 */
export function humanModelError(err: unknown, language: 'fa' | 'en' | 'other' = 'fa'): string {
  const e = err as RetryableError | undefined;
  const status = e?.status ?? 0;
  const fa = language === 'fa';

  if (isTimeoutError(err) || e?.name === 'AbortError') {
    return fa
      ? 'پاسخ مدل بیش از حد طول کشید. مدل احتمالاً هنوز در حال کار است؛ چند لحظه بعد دوباره بگویید، نه بلافاصله.'
      : 'The model took too long to respond. It may still be working — wait a moment before trying again.';
  }
  if (status === 429) {
    return fa
      ? 'سرویس مدل موقتاً به سقف مصرف رسیده. چند بار تلاش کردم و باز هم شلوغ بود؛ چند لحظه بعد دوباره بگویید.'
      : 'The model service is over its rate limit. I retried and it was still busy — please try again in a moment.';
  }
  if (status === 401 || status === 403) {
    return fa
      ? 'کلید سرویس مدل پذیرفته نشد. در تنظیمات، کلید را بررسی کنید.'
      : 'The model service rejected the credentials. Check the API key in settings.';
  }
  if (status >= 500) {
    return fa
      ? 'سرویس مدل الان در دسترس نیست. این از سمت آن‌هاست، نه از سیستم شما.'
      : 'The model service is unavailable right now. That is on their side, not yours.';
  }
  if (status === 400 || status === 422) {
    return fa
      ? 'درخواست برای مدل نامعتبر بود. این یک خطای داخلی است و در گزارش ثبت شد.'
      : 'The request to the model was rejected as invalid. This is an internal fault and has been logged.';
  }
  return fa
    ? 'ارتباط با سرویس مدل برقرار نشد. دوباره تلاش کنید.'
    : 'Could not reach the model service. Please try again.';
}

/** Build the error the retry loop throws, carrying what callers need. */
export function providerError(name: string, status: number, body: string, retryAfterMs: number | null): RetryableError {
  // The message stays terse and structured for logs; `humanModelError` is the
  // only thing an owner should ever see.
  const err = new Error(`${name} ${status}`) as RetryableError;
  err.status = status;
  err.detail = body.slice(0, 500);
  if (retryAfterMs !== null) err.retryAfterMs = retryAfterMs;
  return err;
}

export interface FetchWithRetryOpts {
  /** Provider name, for the error message. */
  name: string;
  signal?: AbortSignal | null;
  /** Override total attempts (default MAX_ATTEMPTS). Use 1 for local models. */
  maxAttempts?: number;
  /**
   * Wall-clock for this HTTP call. Applied as AbortSignal.timeout AND as
   * undici headersTimeout/bodyTimeout so Node's 5-minute default cannot win.
   */
  timeoutMs?: number;
  /** Injectable for tests — never sleeps for real in a unit test. */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook: called before each wait. */
  onRetry?: (info: { attempt: number; status: number; waitMs: number }) => void;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const agentByTimeout = new Map<number, Agent>();

/** Reuse Agents so we do not open a new connection pool per call. */
export function llmDispatcherForTimeout(timeoutMs: number): Dispatcher {
  const key = Math.max(1_000, Math.floor(timeoutMs));
  let agent = agentByTimeout.get(key);
  if (!agent) {
    agent = new Agent({
      headersTimeout: key,
      bodyTimeout: key,
      connectTimeout: 30_000,
    });
    agentByTimeout.set(key, agent);
  }
  return agent;
}

/** Merge caller cancellation with a wall-clock timeout. */
export function mergeLlmSignals(
  caller: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  const parts: AbortSignal[] = [];
  if (caller) parts.push(caller);
  if (timeoutMs && timeoutMs > 0) parts.push(AbortSignal.timeout(timeoutMs));
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  // Node 20+: AbortSignal.any
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any(parts);
  // Fallback: abort when either fires.
  const ctrl = new AbortController();
  for (const s of parts) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * POST with retry on backpressure.
 *
 * Returns the successful `Response`. Throws a `RetryableError` carrying the
 * status once the attempts are exhausted, or immediately for anything that
 * retrying cannot fix (timeouts, 4xx except 429/408, owner abort).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOpts,
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  let last: RetryableError | null = null;

  const signal = mergeLlmSignals(opts.signal, opts.timeoutMs);
  const dispatcher = opts.timeoutMs ? llmDispatcherForTimeout(opts.timeoutMs) : undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Cancellation outranks retrying: an owner who cancelled must not wait
    // out a backoff that no longer serves anyone.
    if (signal?.aborted || opts.signal?.aborted) {
      const abort = new Error('aborted') as RetryableError;
      abort.name = 'AbortError';
      throw abort;
    }

    let res: Response;
    try {
      const reqInit = {
        ...init,
        signal: signal ?? init.signal ?? null,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit;
      res = await fetchImpl(url, reqInit);
    } catch (e) {
      // Timeout / abort: the upstream may still be serving the first call.
      // Retrying would stampede a single-slot local model.
      if (isTimeoutError(e)) {
        const abort = new Error(
          opts.timeoutMs
            ? `${opts.name} timed out after ${opts.timeoutMs}ms`
            : `${opts.name} aborted`,
        ) as RetryableError;
        abort.name = (e as Error)?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError';
        abort.detail = (e as Error)?.message?.slice(0, 500);
        throw abort;
      }
      last = providerError(opts.name, 0, (e as Error)?.message ?? 'network error', null);
      if (attempt === maxAttempts) break;
      const waitMs = backoffMs(attempt, null);
      opts.onRetry?.({ attempt, status: 0, waitMs });
      await sleep(waitMs);
      continue;
    }

    if (res.ok) return res;

    const body = await res.text();
    const hint = parseRetryAfterMs(res.headers, body);
    last = providerError(opts.name, res.status, body, hint);

    // Not worth retrying, or out of attempts: fail now with the real status.
    if (!isRetryable(res.status) || attempt === maxAttempts) break;

    const waitMs = backoffMs(attempt, hint);
    opts.onRetry?.({ attempt, status: res.status, waitMs });
    await sleep(waitMs);
  }

  throw last ?? providerError(opts.name, 0, 'unknown provider failure', null);
}
