/**
 * Peer discovery for service-to-service HTTP calls.
 *
 * Resolution order for a peer's base URL:
 *   1. Env override `<SERVICE_ID_UPPER_SNAKE>_URL` (e.g. ARCHITECT_AGENT_URL).
 *      In production each service sets these to subdomains
 *      (https://architect.simorx.com), keeping deployments fully independent.
 *   2. Localhost default derived from the canonical SERVICE_PORTS.
 *
 * This keeps cross-service communication HTTP-only and Dokploy-friendly: no
 * shared runtime code, just configured URLs + the internal token.
 */
import { SERVICE_PORTS, INTERNAL_TOKEN_HEADER } from '../constants/index.js';
import type { TaskRequest } from '../schemas/task.js';

export function peerEnvKey(serviceId: string): string {
  return `${serviceId.toUpperCase().replace(/-/g, '_')}_URL`;
}

export function peerUrl(serviceId: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[peerEnvKey(serviceId)];
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  const port = (SERVICE_PORTS as Record<string, number>)[serviceId];
  return `http://localhost:${port ?? 0}`;
}

export interface PeerDispatchResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface PeerClientConfig {
  internalToken: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Thin typed client for dispatching tasks to a peer service's /.factory/task. */
export class PeerClient {
  constructor(private readonly cfg: PeerClientConfig) {}

  url(serviceId: string): string {
    return peerUrl(serviceId, this.cfg.env);
  }

  async dispatchTask<T = Record<string, unknown>>(
    serviceId: string,
    body: TaskRequest,
  ): Promise<PeerDispatchResult<T>> {
    const url = `${this.url(serviceId)}/.factory/task`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: this.cfg.internalToken },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
      return { ok: res.ok, status: res.status, data: json.data, error: json.error?.message };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : 'request failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}
