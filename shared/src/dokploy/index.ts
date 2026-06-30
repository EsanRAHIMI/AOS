/**
 * Phase 16 — Dokploy API client (server-side only; the token never reaches the
 * browser). Safe wrappers over the Dokploy HTTP API. Every method returns a
 * structured result instead of throwing, so the executor can fall back to exact
 * manual steps when a call is unsupported or fails — success is never faked.
 *
 * Endpoint paths follow Dokploy's `/api/*` surface; names can vary by Dokploy
 * version. Methods that a given deployment does not support simply return
 * { ok:false } and the operation step becomes `manual_required` (not a fake pass).
 */
export interface DokployConfig {
  baseUrl: string;
  apiToken: string;
  projectId?: string;
  environmentId?: string;
}

export function isDokployConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DOKPLOY_BASE_URL && env.DOKPLOY_API_TOKEN);
}

export function dokployConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DokployConfig | null {
  if (!env.DOKPLOY_BASE_URL || !env.DOKPLOY_API_TOKEN) return null;
  return {
    baseUrl: env.DOKPLOY_BASE_URL.replace(/\/$/, ''),
    apiToken: env.DOKPLOY_API_TOKEN,
    projectId: env.DOKPLOY_PROJECT_ID || undefined,
    environmentId: env.DOKPLOY_ENVIRONMENT_ID || undefined,
  };
}

export interface DokployResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** True when the method/endpoint isn't supported by this Dokploy → use manual path. */
  unsupported?: boolean;
}

export interface CreateApplicationInput {
  name: string;
  appName?: string;
  projectId?: string;
  environmentId?: string;
  domain?: string;
  port?: number | null;
  rootDir?: string;
}

const SECRETY = /(token|secret|password|key|authorization|x-api-key)/i;
/** Redact any secret-looking fields before storing a request/response summary. */
export function redactSummary(obj: unknown, max = 240): string {
  try {
    const seen = JSON.stringify(obj, (k, v) => (SECRETY.test(k) ? '<redacted>' : v));
    return (seen ?? '').slice(0, max);
  } catch {
    return '';
  }
}

export class DokployClient {
  constructor(private readonly cfg: DokployConfig) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<DokployResult<T>> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiToken, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
      if (res.status === 404) return { ok: false, status: 404, unsupported: true, error: 'endpoint not available on this Dokploy version' };
      if (!res.ok) {
        const msg = typeof data === 'string' ? data.slice(0, 200) : ((data as { message?: string })?.message ?? `HTTP ${res.status}`);
        return { ok: false, status: res.status, error: msg };
      }
      return { ok: true, status: res.status, data: data as T };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : 'network error' };
    }
  }

  testConnection(): Promise<DokployResult> { return this.call('/api/project.all', { method: 'GET' }); }
  listProjects(): Promise<DokployResult> { return this.call('/api/project.all', { method: 'GET' }); }
  listEnvironments(projectId: string): Promise<DokployResult> { return this.call(`/api/project.one?projectId=${encodeURIComponent(projectId)}`, { method: 'GET' }); }
  listApplications(projectId: string): Promise<DokployResult> { return this.call(`/api/project.one?projectId=${encodeURIComponent(projectId)}`, { method: 'GET' }); }
  getApplication(appId: string): Promise<DokployResult> { return this.call(`/api/application.one?applicationId=${encodeURIComponent(appId)}`, { method: 'GET' }); }
  createApplication(input: CreateApplicationInput): Promise<DokployResult> {
    return this.call('/api/application.create', { method: 'POST', body: JSON.stringify({ name: input.name, appName: input.appName ?? input.name, projectId: input.projectId ?? this.cfg.projectId, environmentId: input.environmentId ?? this.cfg.environmentId }) });
  }
  updateApplicationConfig(appId: string, input: Record<string, unknown>): Promise<DokployResult> {
    return this.call('/api/application.update', { method: 'POST', body: JSON.stringify({ applicationId: appId, ...input }) });
  }
  setEnvironmentVariables(appId: string, env: string): Promise<DokployResult> {
    return this.call('/api/application.saveEnvironment', { method: 'POST', body: JSON.stringify({ applicationId: appId, env }) });
  }
  deployApplication(appId: string): Promise<DokployResult> { return this.call('/api/application.deploy', { method: 'POST', body: JSON.stringify({ applicationId: appId }) }); }
  restartApplication(appId: string): Promise<DokployResult> { return this.call('/api/application.reload', { method: 'POST', body: JSON.stringify({ applicationId: appId }) }); }
  getDeploymentStatus(appId: string): Promise<DokployResult> { return this.call(`/api/application.one?applicationId=${encodeURIComponent(appId)}`, { method: 'GET' }); }
  getApplicationLogs(appId: string): Promise<DokployResult> { return this.call(`/api/application.readAppMonitoring?applicationId=${encodeURIComponent(appId)}`, { method: 'GET' }); }
}

export function dokployClientFromEnv(env: NodeJS.ProcessEnv = process.env): DokployClient | null {
  const cfg = dokployConfigFromEnv(env);
  return cfg ? new DokployClient(cfg) : null;
}

/* ============================ Phase 17 — calibration ============================ */
import { genId, nowIso } from '../utils/index.js';
import type { DokployApiDiagnostic } from '../schemas/operations-plan.js';

/** Describe a JSON value's shape using KEYS ONLY (no values, so no secrets). */
export function responseShapeOf(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return 'array[0]';
    const first = data[0];
    const keys = first && typeof first === 'object' ? Object.keys(first as object).slice(0, 16) : [];
    return `array[${data.length}] of {${keys.join(', ')}}`;
  }
  if (data && typeof data === 'object') return `{${Object.keys(data as object).slice(0, 20).join(', ')}}`;
  return typeof data;
}

/** A redacted, truncated sample of (one element of) a response — never includes secrets. */
export function sanitizedSample(data: unknown, max = 300): string {
  const one = Array.isArray(data) ? data.slice(0, 1) : data;
  return redactSummary(one, max);
}

/**
 * Probe the real Dokploy API with READ-ONLY calls to discover actual paths/shapes.
 * Mutation endpoints (deploy/restart/env) are intentionally NOT called here — their
 * support is confirmed at execution time, and they are recorded as not-probed.
 */
export async function buildDiagnostics(client: DokployClient, baseUrl: string): Promise<DokployApiDiagnostic[]> {
  const now = nowIso();
  const recs: DokployApiDiagnostic[] = [];
  const push = (endpoint: string, method: string, category: string, r: DokployResult): void => {
    recs.push({
      diagnosticId: genId('diag'), baseUrl, endpoint, method, category,
      status: r.status, supported: r.ok,
      responseShape: r.ok ? responseShapeOf(r.data) : '',
      sanitizedSample: r.ok ? sanitizedSample(r.data) : '',
      error: r.ok ? '' : (r.unsupported ? 'unsupported (404)' : (r.error ?? 'failed')),
      createdAt: now,
    });
  };
  const projects = await client.listProjects();
  push('/api/project.all', 'GET', 'projects', projects);

  let firstProjectId: string | undefined;
  let firstAppId: string | undefined;
  if (projects.ok && Array.isArray(projects.data) && projects.data.length) {
    const p0 = projects.data[0] as Record<string, unknown>;
    firstProjectId = String(p0.projectId ?? p0.id ?? p0._id ?? '') || undefined;
    const apps = (Array.isArray(p0.applications) ? p0.applications : (p0.environment as { applications?: unknown[] })?.applications) as Array<Record<string, unknown>> | undefined;
    const a0 = apps && apps.length ? apps[0]! : undefined;
    if (a0) firstAppId = String(a0.applicationId ?? a0.id ?? '') || undefined;
  }
  if (firstProjectId) push('/api/project.one?projectId=…', 'GET', 'project_detail', await client.listEnvironments(firstProjectId));
  if (firstAppId) push('/api/application.one?applicationId=…', 'GET', 'application_detail', await client.getApplication(firstAppId));

  for (const [endpoint, category] of [['/api/application.deploy', 'deploy'], ['/api/application.reload', 'restart'], ['/api/application.saveEnvironment', 'env_vars'], ['/api/application.readAppMonitoring', 'logs']] as const) {
    recs.push({ diagnosticId: genId('diag'), baseUrl, endpoint, method: 'POST', category, status: 0, supported: false, responseShape: '', sanitizedSample: '', error: 'not probed — mutation/side-effecting endpoint; support confirmed at execution time', createdAt: now });
  }
  return recs;
}

export interface ParsedTarget {
  projectName: string;
  environmentName: string;
  appName: string;
  serviceId: string;
  domain: string;
  port: number | null;
  rootDir: string;
  status: string;
}

/**
 * Calibrated parser: tolerates several Dokploy response shapes. Missing fields are
 * left empty (UI shows "unknown") — never invented.
 */
export function parseDokployTargets(projectsData: unknown): ParsedTarget[] {
  const out: ParsedTarget[] = [];
  const projects = Array.isArray(projectsData) ? (projectsData as Array<Record<string, unknown>>) : [];
  for (const pr of projects) {
    const projectName = String(pr.name ?? pr.projectName ?? pr.projectId ?? pr.id ?? 'unknown');
    const environments = Array.isArray(pr.environments) ? (pr.environments as Array<Record<string, unknown>>) : null;
    const collect = (envName: string, apps: Array<Record<string, unknown>>): void => {
      for (const a of apps) {
        const appName = String(a.appName ?? a.name ?? a.applicationId ?? a.id ?? 'unknown');
        const domains = Array.isArray(a.domains) ? (a.domains as Array<Record<string, unknown>>) : [];
        const d0 = domains.length ? domains[0]! : undefined;
        out.push({
          projectName, environmentName: envName,
          appName, serviceId: String(a.appName ?? a.name ?? ''),
          domain: String(d0?.host ?? a.domain ?? ''),
          port: typeof a.port === 'number' ? a.port : (d0 && typeof d0.port === 'number' ? d0.port : null),
          rootDir: String(a.rootDirectory ?? a.rootDir ?? a.sourceRootDirectory ?? ''),
          status: String(a.applicationStatus ?? a.status ?? 'unknown'),
        });
      }
    };
    if (environments) {
      for (const e of environments) collect(String(e.name ?? 'production'), (Array.isArray(e.applications) ? e.applications : []) as Array<Record<string, unknown>>);
    } else {
      const envName = String((pr.environment as { name?: string })?.name ?? 'production');
      const apps = (Array.isArray(pr.applications) ? pr.applications : (pr.environment as { applications?: unknown[] })?.applications ?? []) as Array<Record<string, unknown>>;
      collect(envName, apps);
    }
  }
  return out;
}

export interface AosMappingRow {
  serviceId: string;
  status: 'mapped' | 'not_found_in_dokploy_sync';
  appName: string | null;
  domain: string | null;
  lastKnownStatus: string | null;
}

/** Map AOS catalog service ids to real synced Dokploy targets; honest "not_found" otherwise. */
export function mapAosServices(catalogIds: string[], targets: Array<{ serviceId?: string; appName?: string; domain?: string; lastKnownStatus?: string }>): AosMappingRow[] {
  return catalogIds.map((id) => {
    const base = id.replace(/-(agent|service|web|api)$/, '');
    const t = targets.find((x) => x.serviceId === id || x.appName === id || (x.domain ? x.domain.includes(base) : false));
    return { serviceId: id, status: t ? 'mapped' : 'not_found_in_dokploy_sync', appName: t?.appName ?? null, domain: t?.domain ?? null, lastKnownStatus: t?.lastKnownStatus ?? null };
  });
}
