import { randomBytes, randomUUID } from 'node:crypto';

/** Current time as an ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Generate a prefixed id, e.g. genId('task') -> 'task_8f2c1a9b4d'.
 * Short, URL-safe, collision-resistant enough for system records.
 */
export function genId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export function uuid(): string {
  return randomUUID();
}

/** Discriminated result type for explicit, non-throwing error handling. */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Sleep helper for retries/backoff. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
