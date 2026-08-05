/**
 * Local LLM concurrency gate — one in-flight call when OLLAMA_NUM_PARALLEL=1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Semaphore, withLocalLlmSlot, resetLocalLlmGate, localLlmGate } from '../src/llm/concurrency.js';
import { llmHttpConfigFromEnv } from '../src/llm/config.js';
import { isTimeoutError } from '../src/llm/resilience.js';

describe('Semaphore', () => {
  it('runs at most max callers at once and queues the rest', async () => {
    const sem = new Semaphore(1);
    let concurrent = 0;
    let peak = 0;
    const run = async () => {
      const release = await sem.acquire();
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent -= 1;
      release();
    };
    await Promise.all([run(), run(), run()]);
    expect(peak).toBe(1);
  });

  it('rejects a waiter when its AbortSignal fires before a slot opens', async () => {
    const sem = new Semaphore(1);
    const hold = await sem.acquire();
    const ctrl = new AbortController();
    const waiting = sem.acquire(ctrl.signal);
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    hold();
  });
});

describe('withLocalLlmSlot', () => {
  beforeEach(() => resetLocalLlmGate());

  it('serialises local calls through the process-wide gate', async () => {
    let concurrent = 0;
    let peak = 0;
    const work = () => withLocalLlmSlot(1, async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 25));
      concurrent -= 1;
      return 'ok';
    });
    await Promise.all([work(), work()]);
    expect(peak).toBe(1);
    expect(localLlmGate(1).inFlight).toBe(0);
  });
});

describe('llmHttpConfigFromEnv', () => {
  it('defaults local timeout above undici\'s 5-minute headersTimeout', () => {
    const cfg = llmHttpConfigFromEnv({});
    expect(cfg.localTimeoutMs).toBeGreaterThan(300_000);
    expect(cfg.localMaxAttempts).toBe(1);
    expect(cfg.localMaxConcurrent).toBe(1);
  });

  it('reads overrides from env', () => {
    const cfg = llmHttpConfigFromEnv({
      LLM_LOCAL_HTTP_TIMEOUT_MS: '900000',
      LLM_LOCAL_HTTP_MAX_ATTEMPTS: '2',
      LLM_LOCAL_MAX_CONCURRENT: '1',
    });
    expect(cfg.localTimeoutMs).toBe(900_000);
    expect(cfg.localMaxAttempts).toBe(2);
  });
});

describe('isTimeoutError', () => {
  it('recognises undici header timeouts so they are never retried', () => {
    const err = new Error('Headers Timeout Error');
    err.name = 'TimeoutError';
    (err as { code?: string }).code = 'UND_ERR_HEADERS_TIMEOUT';
    expect(isTimeoutError(err)).toBe(true);
  });
});
