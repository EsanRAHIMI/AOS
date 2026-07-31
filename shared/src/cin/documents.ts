/**
 * CIN Documents (CIN-1b, D-185) — the owner's records and papers as
 * first-class citizens of the identity graph.
 *
 * A document is not a file. It is a RECORD about the owner: what it is, who
 * issued it, when it expires, what it proves. The file (a scan, a PDF) is an
 * optional attachment. That order matters:
 *
 *  - a record with no file is still fully useful — the system can warn you
 *    that your passport expires in 40 days without ever holding a scan of it,
 *  - the attachment is honest about itself: `file: null` means "no file
 *    stored", never a broken link or a pretend one,
 *  - a document may be backed by a verifiable claim (`linkedClaimId`), which
 *    is how "I have a degree" becomes something a counterparty can check
 *    without seeing the certificate.
 *
 * Every mutation is anchored in the CIN ledger, so the owner's paperwork has
 * the same tamper-evident history as the rest of their identity.
 */
import { z } from 'zod';
import { keyedScopedCollection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';
import { appendLedger } from './ledger.js';

export const CinDocumentType = z.enum([
  'identity',     // passport, national id, birth certificate
  'education',    // degree, transcript, certificate
  'employment',   // contract, payslip, reference
  'financial',    // bank statement, tax return, invoice
  'legal',        // deed, power of attorney, court record
  'medical',      // report, prescription, insurance
  'contract',     // any signed agreement
  'license',      // permit, membership, registration
  'other',
]);
export type CinDocumentType = z.infer<typeof CinDocumentType>;

export const CinDocumentStatus = z.enum(['active', 'expiring', 'expired', 'superseded', 'archived']);
export type CinDocumentStatus = z.infer<typeof CinDocumentStatus>;

/** The stored file, when there is one. `null` on the document means none. */
export const CinDocumentFileSchema = z.object({
  objectId: z.string(),
  bucket: z.string(),
  key: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  originalName: z.string().default(''),
  uploadedAt: z.string(),
});
export type CinDocumentFile = z.infer<typeof CinDocumentFileSchema>;

export const CinDocumentSchema = z.object({
  docId: z.string(),
  /** The CIN entity this document belongs to (usually the owner). */
  ownerEntityId: z.string(),
  title: z.string().min(1),
  docType: CinDocumentType,
  issuer: z.string().default(''),
  /** Reference/serial number. Kept separate so it can be redacted on share. */
  reference: z.string().default(''),
  issuedAt: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  notes: z.string().default(''),
  tags: z.array(z.string()).default([]),
  /** Verifiable claim that attests this document, when one was issued. */
  linkedClaimId: z.string().nullable().default(null),
  /** Which profile section this paper backs (e.g. 'education'). */
  section: z.string().default(''),
  file: CinDocumentFileSchema.nullable().default(null),
  status: CinDocumentStatus.default('active'),
  createdAt: z.string(),
  updatedAt: z.string(),
}).merge(ScopeFieldsSchema);
export type CinDocument = z.infer<typeof CinDocumentSchema>;

const docsCol = (actor: CinDocActor) => keyedScopedCollection<CinDocument>(COLLECTIONS.CIN_DOCUMENTS, 'createdBy', actor.actorId);

export interface CinDocActor { actorId: string; tenantId?: string | null }

/** Days before expiry at which a document starts warning. */
export const EXPIRY_WARNING_DAYS = 45;

/**
 * Status derived from dates — never stored stale. A document the owner has
 * archived stays archived; everything else is judged against the clock.
 */
export function deriveStatus(doc: Pick<CinDocument, 'expiresAt' | 'status'>, now = Date.now()): CinDocumentStatus {
  if (doc.status === 'archived' || doc.status === 'superseded') return doc.status;
  if (!doc.expiresAt) return 'active';
  const at = Date.parse(doc.expiresAt);
  if (!Number.isFinite(at)) return 'active';
  if (at <= now) return 'expired';
  if (at - now <= EXPIRY_WARNING_DAYS * 86_400_000) return 'expiring';
  return 'active';
}

export interface CreateDocumentInput {
  ownerEntityId: string;
  title: string;
  docType: CinDocumentType;
  issuer?: string;
  reference?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string;
  tags?: string[];
  section?: string;
  linkedClaimId?: string | null;
}

export async function createDocument(actor: CinDocActor, input: CreateDocumentInput): Promise<CinDocument> {
  const now = nowIso();
  const doc: CinDocument = CinDocumentSchema.parse({
    docId: genId('cindoc'),
    ownerEntityId: input.ownerEntityId,
    title: input.title,
    docType: input.docType,
    issuer: input.issuer ?? '',
    reference: input.reference ?? '',
    issuedAt: input.issuedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    notes: input.notes ?? '',
    tags: input.tags ?? [],
    section: input.section ?? '',
    linkedClaimId: input.linkedClaimId ?? null,
    file: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    scope: 'user',
    tenantId: actor.tenantId ?? undefined,
    createdBy: actor.actorId,
  });
  doc.status = deriveStatus(doc);
  await docsCol(actor).insertOne(doc as never);
  await appendLedger({
    recordType: 'document.registered', refId: doc.docId, actorEntityId: actor.actorId,
    summary: `${doc.docType}: ${doc.title}`,
    data: { ownerEntityId: doc.ownerEntityId, docType: doc.docType, expiresAt: doc.expiresAt },
  });
  return doc;
}

export async function listDocuments(
  actor: CinDocActor,
  filter: { ownerEntityId?: string; docType?: CinDocumentType; status?: CinDocumentStatus; includeArchived?: boolean } = {},
): Promise<CinDocument[]> {
  const f: Record<string, unknown> = {};
  if (filter.ownerEntityId) f.ownerEntityId = filter.ownerEntityId;
  if (filter.docType) f.docType = filter.docType;
  const docs = await docsCol(actor).find(f).sort({ createdAt: -1 }).limit(500).toArray();
  const now = Date.now();
  return docs
    .map((d) => {
      const parsed = CinDocumentSchema.parse(d);
      return { ...parsed, status: deriveStatus(parsed, now) };
    })
    .filter((d) => (filter.includeArchived ? true : d.status !== 'archived'))
    .filter((d) => (filter.status ? d.status === filter.status : true));
}

export async function getDocument(actor: CinDocActor, docId: string): Promise<CinDocument | null> {
  const doc = await docsCol(actor).findOne({ docId });
  if (!doc) return null;
  const parsed = CinDocumentSchema.parse(doc);
  return { ...parsed, status: deriveStatus(parsed) };
}

export type UpdateDocumentPatch = Partial<Pick<CinDocument,
  'title' | 'docType' | 'issuer' | 'reference' | 'issuedAt' | 'expiresAt' | 'notes' | 'tags' | 'section' | 'linkedClaimId' | 'status'
>>;

export async function updateDocument(actor: CinDocActor, docId: string, patch: UpdateDocumentPatch): Promise<CinDocument> {
  const current = await getDocument(actor, docId);
  if (!current) throw new Error(`document ${docId} not found`);
  const next: CinDocument = { ...current, ...patch, updatedAt: nowIso() };
  next.status = deriveStatus(next);
  await docsCol(actor).updateOne({ docId }, { $set: { ...patch, status: next.status, updatedAt: next.updatedAt, updatedBy: actor.actorId } });
  await appendLedger({
    recordType: 'document.updated', refId: docId, actorEntityId: actor.actorId,
    summary: `updated: ${Object.keys(patch).join(', ') || 'no fields'}`,
    data: { fields: Object.keys(patch) },
  });
  return next;
}

export async function archiveDocument(actor: CinDocActor, docId: string): Promise<void> {
  const res = await docsCol(actor).updateOne({ docId }, { $set: { status: 'archived', updatedAt: nowIso(), updatedBy: actor.actorId } });
  if (!res.matchedCount) throw new Error(`document ${docId} not found`);
  await appendLedger({ recordType: 'document.archived', refId: docId, actorEntityId: actor.actorId, summary: 'archived', data: {} });
}

/** Attach a stored file. The caller has already put the bytes in object
 *  storage — this only records WHERE they are, and anchors that fact. */
export async function attachDocumentFile(actor: CinDocActor, docId: string, file: Omit<CinDocumentFile, 'uploadedAt'>): Promise<CinDocument> {
  const current = await getDocument(actor, docId);
  if (!current) throw new Error(`document ${docId} not found`);
  const stored: CinDocumentFile = CinDocumentFileSchema.parse({ ...file, uploadedAt: nowIso() });
  await docsCol(actor).updateOne({ docId }, { $set: { file: stored, updatedAt: stored.uploadedAt, updatedBy: actor.actorId } });
  await appendLedger({
    recordType: 'document.file_attached', refId: docId, actorEntityId: actor.actorId,
    summary: `file attached (${stored.mimeType}, ${stored.size} bytes)`,
    data: { bucket: stored.bucket, key: stored.key, size: stored.size },
  });
  return { ...current, file: stored, updatedAt: stored.uploadedAt };
}

export interface DocumentSummary {
  total: number;
  withFile: number;
  expiring: CinDocument[];
  expired: CinDocument[];
  byType: Record<string, number>;
}

/** What the profile surface and the heartbeat both need to know. */
export async function summariseDocuments(actor: CinDocActor, ownerEntityId: string): Promise<DocumentSummary> {
  const docs = await listDocuments(actor, { ownerEntityId });
  const byType: Record<string, number> = {};
  for (const d of docs) byType[d.docType] = (byType[d.docType] ?? 0) + 1;
  return {
    total: docs.length,
    withFile: docs.filter((d) => d.file !== null).length,
    expiring: docs.filter((d) => d.status === 'expiring'),
    expired: docs.filter((d) => d.status === 'expired'),
    byType,
  };
}
