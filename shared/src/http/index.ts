/**
 * Consistent API response envelope used by every service. Clients (including
 * the dashboard and other agents) can rely on a single shape.
 */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function success<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

export function failure(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, details } };
}

/** Standard error codes shared across services. */
export const ERROR_CODES = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation_error',
  CONFLICT: 'conflict',
  UPSTREAM: 'upstream_error',
  INTERNAL: 'internal_error',
  APPROVAL_REQUIRED: 'approval_required',
  RATE_LIMITED: 'rate_limited',
  SAFE_MODE: 'safe_mode_blocked',
} as const;
