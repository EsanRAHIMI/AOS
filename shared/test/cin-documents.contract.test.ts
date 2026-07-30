/**
 * CIN-1b (D-185) — document registry proofs.
 *
 * The point of this module is that a RECORD is useful without a FILE, and that
 * the system is never vague about which it has. These tests pin exactly that:
 * expiry is derived from the clock (never stored stale), a document with no
 * file says so honestly, and every mutation lands in the tamper-evident chain.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  createDocument, listDocuments, getDocument, updateDocument, archiveDocument,
  attachDocumentFile, summariseDocuments, deriveStatus, EXPIRY_WARNING_DAYS,
  documentStorageAvailability, documentObjectKey,
  listLedger, verifyChain,
} from '../src/cin/index.js';

const actor = { actorId: 'esan', tenantId: null };
const OWNER = 'cin_owner_1';

beforeEach(() => { setTestDb(createFakeDb().db); });

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('document records', () => {
  it('registers a record with no file and anchors it in the ledger', async () => {
    const doc = await createDocument(actor, { ownerEntityId: OWNER, title: 'پاسپورت', docType: 'identity', issuer: 'NOCR' });
    expect(doc.docId).toMatch(/^cindoc_/);
    expect(doc.file).toBeNull();          // honest: no file, not a broken link
    expect(doc.status).toBe('active');
    const ledger = await listLedger();
    expect(ledger.at(-1)?.recordType).toBe('document.registered');
    expect((await verifyChain()).ok).toBe(true);
  });

  it('derives status from the clock rather than trusting stored state', async () => {
    expect(deriveStatus({ expiresAt: null, status: 'active' })).toBe('active');
    expect(deriveStatus({ expiresAt: inDays(-1), status: 'active' })).toBe('expired');
    expect(deriveStatus({ expiresAt: inDays(EXPIRY_WARNING_DAYS - 5), status: 'active' })).toBe('expiring');
    expect(deriveStatus({ expiresAt: inDays(EXPIRY_WARNING_DAYS + 30), status: 'active' })).toBe('active');
    // An archived document stays archived regardless of dates.
    expect(deriveStatus({ expiresAt: inDays(-100), status: 'archived' })).toBe('archived');
  });

  it('surfaces expiring and expired papers in the summary', async () => {
    await createDocument(actor, { ownerEntityId: OWNER, title: 'ok', docType: 'license', expiresAt: inDays(400) });
    await createDocument(actor, { ownerEntityId: OWNER, title: 'soon', docType: 'identity', expiresAt: inDays(10) });
    await createDocument(actor, { ownerEntityId: OWNER, title: 'gone', docType: 'contract', expiresAt: inDays(-3) });
    const s = await summariseDocuments(OWNER);
    expect(s.total).toBe(3);
    expect(s.withFile).toBe(0);
    expect(s.expiring.map((d) => d.title)).toEqual(['soon']);
    expect(s.expired.map((d) => d.title)).toEqual(['gone']);
    expect(s.byType).toMatchObject({ license: 1, identity: 1, contract: 1 });
  });

  it('updates and archives, each leaving its own ledger record', async () => {
    const doc = await createDocument(actor, { ownerEntityId: OWNER, title: 'قرارداد', docType: 'contract' });
    const updated = await updateDocument(actor, doc.docId, { issuer: 'ACME', expiresAt: inDays(5) });
    expect(updated.issuer).toBe('ACME');
    expect(updated.status).toBe('expiring');       // recomputed, not copied

    await archiveDocument(actor, doc.docId);
    expect((await getDocument(doc.docId))?.status).toBe('archived');
    // archived documents drop out of the default listing
    expect(await listDocuments({ ownerEntityId: OWNER })).toHaveLength(0);
    expect(await listDocuments({ ownerEntityId: OWNER, includeArchived: true })).toHaveLength(1);

    const types = (await listLedger()).map((r) => r.recordType);
    expect(types).toContain('document.updated');
    expect(types).toContain('document.archived');
    expect((await verifyChain()).ok).toBe(true);
  });

  it('records an attached file as metadata only, and keeps the chain intact', async () => {
    const doc = await createDocument(actor, { ownerEntityId: OWNER, title: 'مدرک', docType: 'education' });
    const withFile = await attachDocumentFile(actor, doc.docId, {
      objectId: 'k', bucket: 'b', key: 'factory/documents/x/y.pdf',
      mimeType: 'application/pdf', size: 1234, originalName: 'degree.pdf',
    });
    expect(withFile.file?.size).toBe(1234);
    expect(withFile.file?.uploadedAt).toBeTruthy();
    expect((await summariseDocuments(OWNER)).withFile).toBe(1);
    expect((await listLedger()).at(-1)?.recordType).toBe('document.file_attached');
    expect((await verifyChain()).ok).toBe(true);
  });

  it('fails loudly on a missing document instead of silently creating one', async () => {
    await expect(updateDocument(actor, 'cindoc_nope', { title: 'x' })).rejects.toThrow('not found');
    await expect(archiveDocument(actor, 'cindoc_nope')).rejects.toThrow('not found');
  });
});

describe('document storage seam', () => {
  it('reports not-configured with the exact missing variables', () => {
    const a = documentStorageAvailability({} as NodeJS.ProcessEnv);
    expect(a.configured).toBe(false);
    expect(a.reason).toContain('AWS_ACCESS_KEY_ID');
    expect(a.reason).toContain('AWS_S3_BUCKET');
  });

  it('reports configured only when every variable is present', () => {
    const env = {
      AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b',
      AWS_REGION: 'eu-central-1', AWS_S3_BUCKET: 'bucket',
    } as unknown as NodeJS.ProcessEnv;
    const a = documentStorageAvailability(env);
    expect(a.configured).toBe(true);
    expect(a.reason).toBe('');
    expect(a.bucket).toBe('bucket');
  });

  it('builds an owner-scoped, sanitised object key', () => {
    const key = documentObjectKey('cin_abc', 'cindoc_1', '../../etc/pass word.pdf');
    expect(key.startsWith('factory/documents/cin_abc/cindoc_1/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain(' ');
  });
});
