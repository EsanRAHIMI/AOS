'use server';
/**
 * Owner profile actions (CIN-1b, D-185).
 *
 * Every mutation goes through the CIN entity graph / document registry, so the
 * profile inherits versioning, visibility and the tamper-evident ledger for
 * free. Nothing here writes to a parallel store.
 */
import { gateway } from '@/lib/gateway';
import { revalidatePath } from 'next/cache';

export interface SectionSaveResult { ok: boolean; error: string }

/**
 * Replace one profile section. Sections are stored whole and version-bumped
 * by the kernel — this action never patches fields silently.
 */
export async function saveSectionAction(
  entityId: string,
  section: string,
  data: Record<string, unknown>,
  visibility?: string,
): Promise<SectionSaveResult> {
  if (!entityId || !section) return { ok: false, error: 'entity and section are required' };
  const res = await gateway.updateCinSection(entityId, section, data, visibility);
  revalidatePath('/me/profile');
  return res ? { ok: true, error: '' } : { ok: false, error: 'kernel rejected the update' };
}

export async function createDocumentAction(input: {
  ownerEntityId: string;
  title: string;
  docType: string;
  issuer?: string;
  reference?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string;
  section?: string;
}): Promise<SectionSaveResult> {
  if (!input.ownerEntityId || !input.title.trim()) return { ok: false, error: 'title is required' };
  const res = await gateway.createCinDocument({
    ...input,
    issuedAt: input.issuedAt || null,
    expiresAt: input.expiresAt || null,
  });
  revalidatePath('/me/profile');
  return res ? { ok: true, error: '' } : { ok: false, error: 'kernel rejected the document' };
}

export async function archiveDocumentAction(docId: string): Promise<SectionSaveResult> {
  const res = await gateway.archiveCinDocument(docId);
  revalidatePath('/me/profile');
  return res ? { ok: true, error: '' } : { ok: false, error: 'archive failed' };
}

/** Signed, time-limited download URL. Null when there is no stored file or
 *  object storage is not configured — the caller says so plainly. */
export async function documentUrlAction(docId: string): Promise<string | null> {
  const res = await gateway.cinDocumentUrl(docId);
  return res?.url ?? null;
}
