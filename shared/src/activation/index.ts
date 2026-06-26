/**
 * Live Service Activation Engine. Proves a *validated* service is actually
 * *live*: reachable, healthy, registered, manifest-valid, and callable. Runs
 * real HTTP probes against the service's domain using the internal token. The
 * kernel never fakes `active` — a capability is promoted only if these checks
 * pass against a real, reachable service.
 */
import { INTERNAL_TOKEN_HEADER } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import type { ServiceActivation } from '../schemas/operations.js';
import type { ValidationCheck } from '../schemas/reality.js';
import type { EvidenceDraft } from '../validation/index.js';

export interface CheckLiveServiceOptions {
  baseUrl: string;
  serviceName: string;
  capabilityId: string;
  expectedCapability?: string;
  internalToken: string;
  /** Whether the service-registry already has this service. */
  registered?: boolean;
  taskId?: string | null;
  timeoutMs?: number;
}

export interface CheckLiveServiceResult {
  activation: ServiceActivation;
  evidence: EvidenceDraft[];
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response | null; ms: number; error?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, ms: Date.now() - start };
  } catch (e) {
    return { res: null, ms: Date.now() - start, error: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    clearTimeout(t);
  }
}

/** Probe a live service against the activation contract. */
export async function checkLiveService(opts: CheckLiveServiceOptions): Promise<CheckLiveServiceResult> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const timeout = opts.timeoutMs ?? 8000;
  const tokenHeader = { [INTERNAL_TOKEN_HEADER]: opts.internalToken };
  const checks: ValidationCheck[] = [];
  const add = (name: string, passed: boolean, detail = ''): void => { checks.push({ name, passed, detail }); };
  const evidence: EvidenceDraft[] = [];

  add('registered_in_registry', Boolean(opts.registered), opts.registered ? 'present' : 'not registered');

  // /health
  const health = await timedFetch(`${base}/health`, {}, timeout);
  const healthBody = health.res && health.res.ok ? await health.res.json().catch(() => null) : null;
  add('domain_reachable', health.res !== null, health.error ?? `${health.ms}ms`);
  const healthOk = Boolean(healthBody && (healthBody as { status?: string }).status === 'ok');
  add('health_ok', healthOk, healthOk ? `ok (${health.ms}ms)` : 'no ok status');
  evidence.push({ type: 'health_check_result', summary: `GET /health → ${health.res?.status ?? 'unreachable'} (${health.ms}ms)`, data: { status: health.res?.status ?? null, latencyMs: health.ms, ok: healthOk } });

  // /.factory/manifest
  const man = await timedFetch(`${base}/.factory/manifest`, { headers: tokenHeader }, timeout);
  const manBody = man.res && man.res.ok ? ((await man.res.json().catch(() => null)) as { data?: { serviceId?: string; capabilities?: string[] } } | null) : null;
  const manifest = manBody?.data ?? null;
  add('manifest_valid', Boolean(manifest?.serviceId), manifest?.serviceId ?? 'invalid');
  evidence.push({ type: 'manifest_check_result', summary: `GET /.factory/manifest → ${man.res?.status ?? 'unreachable'}`, data: { serviceId: manifest?.serviceId ?? null } });

  // /.factory/capabilities
  const caps = await timedFetch(`${base}/.factory/capabilities`, { headers: tokenHeader }, timeout);
  const capsBody = caps.res && caps.res.ok ? ((await caps.res.json().catch(() => null)) as { data?: { capabilities?: string[] } } | null) : null;
  const capList = capsBody?.data?.capabilities ?? manifest?.capabilities ?? [];
  add('capabilities_present', capList.length > 0, capList.join(','));
  const want = opts.expectedCapability ?? opts.capabilityId;
  add('capability_linked', capList.includes(want), want);

  // POST /.factory/task — safe probe.
  const task = await timedFetch(`${base}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeader }, body: JSON.stringify({ goal: '__activation_probe__', input: {} }) }, timeout);
  add('task_endpoint_accepts', task.res !== null && task.res.status < 500, `${task.res?.status ?? 'unreachable'}`);
  evidence.push({ type: 'service_response', summary: `POST /.factory/task → ${task.res?.status ?? 'unreachable'}`, data: { status: task.res?.status ?? null } });

  // /.factory/logs
  const logs = await timedFetch(`${base}/.factory/logs`, { headers: tokenHeader }, timeout);
  add('logs_available', logs.res !== null && logs.res.ok, `${logs.res?.status ?? 'unreachable'}`);

  const passedCount = checks.filter((c) => c.passed).length;
  const critical = ['domain_reachable', 'health_ok', 'manifest_valid', 'task_endpoint_accepts'];
  const passed = critical.every((n) => checks.find((c) => c.name === n)?.passed);

  evidence.push({ type: 'deployment_check', summary: `Activation ${passed ? 'passed' : 'failed'} for ${opts.serviceName} (${passedCount}/${checks.length})`, data: { checks, passed, baseUrl: base } });

  const now = nowIso();
  const activation: ServiceActivation = {
    activationId: genId('act'),
    taskId: opts.taskId ?? null,
    serviceName: opts.serviceName,
    capabilityId: opts.capabilityId,
    domain: base,
    checks,
    passed,
    status: passed ? 'passed' : 'failed',
    evidenceIds: [],
    promotedToActive: false,
    incidentId: null,
    createdAt: now,
    updatedAt: now,
  };

  return { activation, evidence };
}
