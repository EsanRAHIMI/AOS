/**
 * CIN API body contracts (CIN-1, D-179) — request schemas for the gateway's
 * /v1/cin/* surface. Live in shared (not the gateway) per kernel convention:
 * services import contracts from @factory/shared and never depend on zod
 * directly.
 */
import { z } from 'zod';
import { CinEntityType, CinRelationType, CinSectionVisibility } from './entities.js';

export const CinCreateEntityBody = z.object({
  entityType: CinEntityType,
  name: z.string().min(1),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sections: z.record(z.string(), z.object({
    data: z.record(z.string(), z.unknown()),
    visibility: CinSectionVisibility.optional(),
  })).optional(),
});
export type CinCreateEntityBody = z.infer<typeof CinCreateEntityBody>;

export const CinUpdateSectionBody = z.object({
  data: z.record(z.string(), z.unknown()),
  visibility: CinSectionVisibility.optional(),
});
export type CinUpdateSectionBody = z.infer<typeof CinUpdateSectionBody>;

export const CinSetStatusBody = z.object({
  status: z.enum(['active', 'suspended', 'archived']),
});
export type CinSetStatusBody = z.infer<typeof CinSetStatusBody>;

export const CinCreateRelationBody = z.object({
  fromEntityId: z.string(),
  toEntityId: z.string(),
  relationType: CinRelationType,
  role: z.string().optional(),
  attestingClaimId: z.string().nullable().optional(),
});
export type CinCreateRelationBody = z.infer<typeof CinCreateRelationBody>;

export const CinIssueClaimBody = z.object({
  issuerEntityId: z.string(),
  subjectEntityId: z.string(),
  claimType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().nullable().optional(),
});
export type CinIssueClaimBody = z.infer<typeof CinIssueClaimBody>;

export const CinRevokeClaimBody = z.object({ reason: z.string().min(1) });
export type CinRevokeClaimBody = z.infer<typeof CinRevokeClaimBody>;

/** Join zod issues into one human-readable message (gateway convenience). */
export function zodIssuesMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}
