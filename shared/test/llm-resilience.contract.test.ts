/**
 * D-211 — a rate limit is flow control, not a failure.
 *
 * The owner asked Jarvis to book a gym session and got back, verbatim:
 *
 *   stopped: model_error — openai-compatible 429: { "error": { "message":
 *   "Rate limit reached for gpt-4.1 in organization org-… Please try again
 *   in 11.242s. …
 *
 * The provider said exactly how long to wait, and we ignored it and gave up.
 * Worse, the owner then repeated the request — so the system converted
 * backpressure into extra load on the very limit that was saturated.
 *
 * These tests pin both halves: waiting when told to wait, and never letting
 * the provider's raw body reach the owner.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseRetryAfterMs, isRetryable, backoffMs, humanModelError,
  fetchWithRetry, providerError, MAX_ATTEMPTS, MAX_BACKOFF_MS,
} from '../src/llm/resilience.js';

/** The real 429 body from the report, trimmed to what matters. */
const RATE_LIMIT_BODY = JSON.stringify({
  error: {
    message: 'Rate limit reached for gpt-4.1 in organization org-YGyjHyRdCLhI0LoExDQKXfvA on tokens per min (TPM): '
      + 'Limit 30000, Used 27482, Requested 8139. Please try again in 11.242s. '
      + 'Visit https://platform.openai.com/account/rate-limits to learn more.',
    type: 'tokens',
  },
});

describe('reading how long to wait', () => {
  it('prefers the Retry-After header, in seconds', () => {
    const h = new Headers({ 'retry-after': '12' });
    expect(parseRetryAfterMs(h, '')).toBe(12_000);
  });

  it('accepts the HTTP-date form of Retry-After', () => {
    const at = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(new Headers({ 'retry-after': at }), '');
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(7000);
  });

  it('falls back to the number in the body, which is where OpenAI puts it', () => {
    // TPM limits frequently arrive with no Retry-After header at all; this
    // sentence is then the ONLY number available, and a blind exponential
    // backoff would sleep either far too long or far too short.
    expect(parseRetryAfterMs(new Headers(), RATE_LIMIT_BODY)).toBe(11_242);
  });

  it('handles the millisecond phrasing too', () => {
    expect(parseRetryAfterMs(new Headers(), 'Please try again in 250ms.')).toBe(250);
  });

  it('returns null when the provider said nothing, so backoff decides', () => {
    expect(parseRetryAfterMs(new Headers(), 'server exploded')).toBeNull();
  });
});

describe('what is worth retrying', () => {
  it('retries backpressure and upstream faults', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryable(s)).toBe(true);
  });

  it('does NOT retry a request that will be wrong again', () => {
    // Retrying a 400 burns the budget that is already scarce.
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryable(s)).toBe(false);
  });
});

describe('backoff', () => {
  it('honours the provider hint when there is one', () => {
    const ms = backoffMs(1, 11_242);
    expect(ms).toBeGreaterThanOrEqual(11_242);
    expect(ms).toBeLessThan(11_242 + 300);   // hint + jitter only
  });

  it('grows exponentially when there is no hint', () => {
    expect(backoffMs(1, null)).toBeLessThan(backoffMs(3, null));
  });

  it('is always jittered, so parallel turns do not collide again on wake', () => {
    const samples = new Set(Array.from({ length: 20 }, () => backoffMs(1, 5000)));
    expect(samples.size).toBeGreaterThan(1);
  });

  it('never sleeps longer than the cap, whatever the hint claims', () => {
    expect(backoffMs(1, 10 * 60_000)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });
});

describe('the retry loop', () => {
  const sleep = vi.fn(async () => {});

  it('succeeds after a 429, without the caller ever seeing it', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(RATE_LIMIT_BODY, { status: 429 });
      return new Response('{"ok":true}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x/y', { method: 'POST' }, { name: 'test', sleep });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('waits the time the provider asked for', async () => {
    const waits: number[] = [];
    const record = async (ms: number) => { waits.push(ms); };
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response(RATE_LIMIT_BODY, { status: 429 })
        : new Response('{}', { status: 200 });
    }));

    await fetchWithRetry('https://x/y', {}, { name: 'test', sleep: record });
    expect(waits[0]).toBeGreaterThanOrEqual(11_242);
    vi.unstubAllGlobals();
  });

  it('gives up after the attempt cap and reports the real status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(RATE_LIMIT_BODY, { status: 429 })));
    await expect(fetchWithRetry('https://x/y', {}, { name: 'test', sleep }))
      .rejects.toMatchObject({ status: 429 });
    vi.unstubAllGlobals();
  });

  it('does not retry a 400 — it would fail identically and cost the budget', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://x/y', {}, { name: 'test', sleep }))
      .rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('retries a dropped socket, which is exactly the kind that succeeds next', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNRESET');
      return new Response('{}', { status: 200 });
    }));
    const res = await fetchWithRetry('https://x/y', {}, { name: 'test', sleep });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('does NOT retry a client timeout — the upstream may still be serving the first call', async () => {
    // This is the Ollama stampede: undici HeadersTimeout after 5m looked like a
    // network error, so we retried into OLLAMA_NUM_PARALLEL=1 while the first
    // inference was still running. Timeouts must be terminal.
    const fetchMock = vi.fn(async () => {
      const err = new Error('Headers Timeout Error');
      err.name = 'TimeoutError';
      (err as { code?: string }).code = 'UND_ERR_HEADERS_TIMEOUT';
      throw err;
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://x/y', {}, { name: 'local', sleep, timeoutMs: 5_000 }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('honours maxAttempts=1 so local providers never auto-replay a prompt', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://x/y', {}, { name: 'local', sleep, maxAttempts: 1 }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('uses exponential backoff of ~2s, ~4s, ~8s when the provider gives no hint', async () => {
    const waits: number[] = [];
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return calls < 4
        ? new Response('busy', { status: 503 })
        : new Response('{}', { status: 200 });
    }));
    await fetchWithRetry('https://x/y', {}, {
      name: 'test',
      sleep: async (ms) => { waits.push(ms); },
      maxAttempts: 4,
    });
    expect(waits).toHaveLength(3);
    expect(waits[0]).toBeGreaterThanOrEqual(2_000);
    expect(waits[0]).toBeLessThan(2_400);
    expect(waits[1]).toBeGreaterThanOrEqual(4_000);
    expect(waits[1]).toBeLessThan(4_400);
    expect(waits[2]).toBeGreaterThanOrEqual(8_000);
    expect(waits[2]).toBeLessThan(8_400);
    vi.unstubAllGlobals();
  });

  it('abandons a backoff the moment the owner cancels', async () => {
    // Waiting out a rate limit for a request nobody wants any more serves
    // no one — cancellation outranks retrying.
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(fetchWithRetry('https://x/y', {}, { name: 'test', sleep, signal: ctrl.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });

  it('never exceeds the attempt cap', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://x/y', {}, { name: 'test', sleep })).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    vi.unstubAllGlobals();
  });
});

describe('what the owner is allowed to see', () => {
  it('never leaks the organisation id, model or token accounting', () => {
    const err = providerError('openai-compatible', 429, RATE_LIMIT_BODY, 11_242);
    const msg = humanModelError(err, 'fa');
    expect(msg).not.toContain('org-');
    expect(msg).not.toContain('gpt-4.1');
    expect(msg).not.toContain('TPM');
    expect(msg).not.toContain('platform.openai.com');
    expect(msg).not.toContain('{');
  });

  it('says what happened and whether trying again helps', () => {
    const err = providerError('openai-compatible', 429, RATE_LIMIT_BODY, null);
    expect(humanModelError(err, 'fa')).toContain('دوباره');
  });

  it('distinguishes the causes an owner can actually act on', () => {
    const auth = humanModelError(providerError('p', 401, 'no', null), 'fa');
    const upstream = humanModelError(providerError('p', 503, 'no', null), 'fa');
    // A bad key is the owner's to fix; an upstream outage is not, and telling
    // them the same sentence for both wastes their time on the wrong one.
    expect(auth).toContain('کلید');
    expect(upstream).not.toContain('کلید');
  });

  it('keeps the precise error for diagnosis, on the error object', () => {
    const err = providerError('openai-compatible', 429, RATE_LIMIT_BODY, 11_242);
    expect(err.status).toBe(429);
    expect(err.detail).toContain('Rate limit reached');
    expect(err.retryAfterMs).toBe(11_242);
  });

  it('answers in English when the turn is English', () => {
    expect(humanModelError(providerError('p', 429, '', null), 'en')).toMatch(/rate limit/i);
  });
});

describe('stop reasons are sentences too', () => {
  it('never shows a bare machine token to the owner', async () => {
    const { stopReasonSentence } = await import('../src/jarvis/turn-runner.js');
    for (const reason of ['max_steps', 'timeout', 'budget_cost', 'cancelled', 'no_model', 'whatever']) {
      const s = stopReasonSentence(reason, 'fa');
      // A sentence: several words, ending in a full stop. Not `max_steps`.
      expect(s.split(' ').length).toBeGreaterThan(2);
      expect(s.trim().endsWith('.')).toBe(true);
      expect(s).not.toContain('_');
    }
  });
});
