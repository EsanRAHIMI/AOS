/**
 * Server-only gateway client. Runs in Next.js server components / route
 * handlers. The admin token lives in the server environment and is never
 * exposed to the browser.
 */
import 'server-only';

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-factory-admin-token': ADMIN,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<T>;
    return body.data ?? null;
  } catch {
    return null;
  }
}

export const gateway = {
  tasks: () => call<unknown[]>('/v1/tasks'),
  task: (id: string) => call<unknown>(`/v1/tasks/${id}`),
  taskTimeline: (id: string) => call<unknown[]>(`/v1/tasks/${id}/timeline`),
  services: () => call<unknown[]>('/v1/services'),
  approvals: () => call<unknown[]>('/v1/approvals'),
  infrastructure: () => call<unknown[]>('/v1/infrastructure'),
  events: (limit = 100) => call<unknown[]>(`/v1/events?limit=${limit}`),
  systemStatus: () => call<{ taskCount: number; pendingApprovals: number; env: string }>('/v1/system/status'),
  createTask: (goal: string) =>
    call<{ taskId?: string }>('/v1/tasks', { method: 'POST', body: JSON.stringify({ goal }) }),
  decideApproval: (id: string, action: string, reason?: string) =>
    call<unknown>(`/v1/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  confirmInfra: (id: string) =>
    call<unknown>(`/v1/infrastructure/${id}/confirm`, { method: 'POST' }),
};
