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

/* ----------------------- documents (CIN-1b, D-185) ---------------------- */

export const CinCreateDocumentBody = z.object({
  title: z.string().min(1),
  docType: z.enum(['identity', 'education', 'employment', 'financial', 'legal', 'medical', 'contract', 'license', 'other']),
  issuer: z.string().optional(),
  reference: z.string().optional(),
  issuedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  section: z.string().optional(),
  linkedClaimId: z.string().nullable().optional(),
});
export type CinCreateDocumentBody = z.infer<typeof CinCreateDocumentBody>;

export const CinUpdateDocumentBody = CinCreateDocumentBody.partial().extend({
  status: z.enum(['active', 'expiring', 'expired', 'superseded', 'archived']).optional(),
});
export type CinUpdateDocumentBody = z.infer<typeof CinUpdateDocumentBody>;

/** Base64 upload — small owner documents (scans, PDFs), not bulk media. */
export const CinUploadDocumentFileBody = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  /** base64, no data: prefix. */
  contentBase64: z.string().min(1),
});
export type CinUploadDocumentFileBody = z.infer<typeof CinUploadDocumentFileBody>;

/** Join zod issues into one human-readable message (gateway convenience). */
export function zodIssuesMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}
