import type { ServiceManifest, ServiceStatus } from '../schemas/service-manifest.js';

const startedAtMs = Date.now();
const startedAtIso = new Date(startedAtMs).toISOString();

/** Build a manifest from static service metadata. */
export function buildManifest(input: ServiceManifest): ServiceManifest {
  return input;
}

export interface StatusInput {
  serviceId: string;
  version: string;
  status?: ServiceStatus['status'];
  dependencies?: ServiceStatus['dependencies'];
}

/** Build a live status object including uptime since process start. */
export function buildStatus(input: StatusInput): ServiceStatus {
  return {
    serviceId: input.serviceId,
    status: input.status ?? 'ok',
    version: input.version,
    uptimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
    startedAt: startedAtIso,
    checkedAt: new Date().toISOString(),
    dependencies: input.dependencies ?? [],
  };
}
