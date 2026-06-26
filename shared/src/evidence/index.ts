/**
 * Evidence helpers. The kernel never claims success without proof — every
 * meaningful outcome produces an EvidenceRecord. Large blobs (screenshots, full
 * reports) live in S3; the record keeps a summary + structured data + s3ObjectId.
 */
import { genId, nowIso } from '../utils/index.js';
import type { EvidenceRecord, EvidenceType } from '../schemas/reality.js';

export interface BuildEvidenceInput {
  type: EvidenceType;
  summary: string;
  taskId?: string | null;
  capabilityId?: string | null;
  serviceName?: string | null;
  data?: Record<string, unknown>;
  s3ObjectId?: string | null;
}

export function buildEvidence(input: BuildEvidenceInput): EvidenceRecord {
  return {
    evidenceId: genId('ev'),
    taskId: input.taskId ?? null,
    capabilityId: input.capabilityId ?? null,
    serviceName: input.serviceName ?? null,
    type: input.type,
    summary: input.summary,
    data: input.data ?? {},
    s3ObjectId: input.s3ObjectId ?? null,
    createdAt: nowIso(),
  };
}

/** Permission allowlist for browser targets: internal/owned only by default. */
export function isAllowedBrowserTarget(url: string, rootDomain: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.hostname === rootDomain || u.hostname.endsWith(`.${rootDomain}`)) return true;
    return false;
  } catch {
    return false;
  }
}
