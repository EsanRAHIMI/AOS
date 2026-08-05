/**
 * In-flight limiter for local LLM calls.
 *
 * Ollama (and most self-hosted stacks) are often configured with a single
 * parallel inference slot. Without a client-side gate, a timed-out caller
 * that retries — or two Jarvis turns overlapping — parks a second request
 * behind the first and both look "hung" for minutes.
 *
 * Acquire → run → release. Waiters queue FIFO; cancellation of the waiter's
 * AbortSignal unblocks without taking a slot.
 */

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    signal?: AbortSignal | null;
    onAbort?: () => void;
  }> = [];

  constructor(private readonly max: number) {
    if (!Number.isFinite(max) || max < 1) throw new Error('Semaphore max must be >= 1');
  }

  get inFlight(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  async acquire(signal?: AbortSignal | null): Promise<() => void> {
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }

    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: (typeof this.waiters)[number] = {
        resolve: (release) => resolve(release),
        reject,
        signal,
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) this.waiters.splice(idx, 1);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      entry.onAbort = onAbort;
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(entry);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      // Slot transfers directly to the waiter — active count unchanged.
      next.resolve(() => this.release());
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

/** Process-wide gate for local/OpenAI-compatible self-hosted calls. */
let localGate: Semaphore | null = null;
let localGateMax = 0;

export function localLlmGate(maxConcurrent: number): Semaphore {
  if (!localGate || localGateMax !== maxConcurrent) {
    localGate = new Semaphore(maxConcurrent);
    localGateMax = maxConcurrent;
  }
  return localGate;
}

/** Test helper — drop the singleton between cases. */
export function resetLocalLlmGate(): void {
  localGate = null;
  localGateMax = 0;
}

export async function withLocalLlmSlot<T>(
  maxConcurrent: number,
  fn: () => Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  const release = await localLlmGate(maxConcurrent).acquire(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}
