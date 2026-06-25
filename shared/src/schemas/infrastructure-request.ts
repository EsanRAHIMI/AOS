import { z } from 'zod';
import { IsoDate } from './common.js';

export const InfraRequestStatus = z.enum([
  'draft',
  'waiting_user_creation',
  'validating',
  'fulfilled',
  'failed',
  'cancelled',
]);
export type InfraRequestStatus = z.infer<typeof InfraRequestStatus>;

/** Dokploy app spec the human creates manually, then confirms. */
export const DokploySpecSchema = z.object({
  appName: z.string(),
  domain: z.string(),
  port: z.number().int().positive(),
  repository: z.string(),
  rootDirectory: z.string(),
  buildCommand: z.string().default('pnpm run build'),
  startCommand: z.string().default('pnpm run start'),
  healthCheck: z.string().default('/health'),
});
export type DokploySpec = z.infer<typeof DokploySpecSchema>;

/**
 * The system never assumes host control. When it needs new infra it emits one
 * of these for the human to create in Dokploy, then validates reachability.
 */
export const InfrastructureRequestSchema = z.object({
  requestId: z.string(),
  serviceName: z.string(),
  serviceType: z.string(),
  reason: z.string(),
  dokploy: DokploySpecSchema,
  env: z.array(z.string()),
  status: InfraRequestStatus.default('waiting_user_creation'),
  validation: z
    .object({
      domainReachable: z.boolean().optional(),
      healthOk: z.boolean().optional(),
      internalTokenOk: z.boolean().optional(),
      manifestAvailable: z.boolean().optional(),
      registered: z.boolean().optional(),
    })
    .optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type InfrastructureRequest = z.infer<typeof InfrastructureRequestSchema>;
