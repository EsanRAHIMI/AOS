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

/**
 * Phase AG.4 — resolve a peer's base URL with the correct precedence for
 * BOTH local dev and production, when a service-registry-resolved manifest
 * domain is also available. Every service's manifest hardcodes its
 * PRODUCTION subdomain (see e.g. services/internet-research-service/src/
 * factory/manifest.ts) regardless of environment, so once a peer actually
 * self-registers with a reachable LOCAL service-registry, naively preferring
 * `registryDomain ?? peerUrl(...)` makes local dev silently fetch a real
 * production host instead of localhost — reachable, but the wrong service,
 * which typically manifests as a confusing 404 from whatever (if anything)
 * answers that production subdomain. Precedence:
 *   1. Explicit env override (`<SERVICE_ID>_URL`) — always wins when set.
 *      This is how local dev pins a peer to localhost even though the
 *      registry has a (correct-for-production) manifest record.
 *   2. The service-registry's resolved manifest domain, when present —
 *      correct in production, where DNS for that domain is real.
 *   3. `peerUrl()`'s own localhost default, when neither of the above apply
 *      (registry unreachable, or the peer hasn't registered yet).
 */
export function resolvePeerUrl(
  serviceId: string,
  registryDomain: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[peerEnvKey(serviceId)];
  if (override && override.length > 0) return override.replace(/\/+$/, '');
  if (registryDomain && registryDomain.length > 0) return registryDomain.replace(/\/+$/, '');
  return peerUrl(serviceId, env);
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
