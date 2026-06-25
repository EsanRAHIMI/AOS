import { z } from 'zod';

/**
 * Service manifest returned by GET /.factory/manifest on every service.
 * The Service Registry stores these to know what exists in the system.
 */
export const ServiceManifestSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  serviceType: z.enum(['agent', 'gateway', 'web', 'infra', 'integration']),
  version: z.string(),
  domain: z.string().url().or(z.string()),
  healthEndpoint: z.string().default('/health'),
  capabilities: z.array(z.string()),
  dependencies: z.array(z.string()),
  requiredEnv: z.array(z.string()),
});
export type ServiceManifest = z.infer<typeof ServiceManifestSchema>;

/** Live status returned by GET /.factory/status. */
export const ServiceStatusSchema = z.object({
  serviceId: z.string(),
  status: z.enum(['ok', 'degraded', 'down', 'starting']),
  version: z.string(),
  uptimeSeconds: z.number(),
  startedAt: z.string(),
  checkedAt: z.string(),
  dependencies: z
    .array(
      z.object({
        serviceId: z.string(),
        reachable: z.boolean(),
        latencyMs: z.number().optional(),
      }),
    )
    .default([]),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
