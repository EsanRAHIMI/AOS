/**
 * CIN-1 (D-179) — Trust & Identity Core proofs:
 * living entity graph (typed entities, versioned sections, visibility),
 * typed relations with duplicate guard, verifiable Ed25519 claims
 * (sign/verify/expiry/revocation/selective-disclosure hash), and the
 * tamper-evident hash-chained ledger (verifyChain detects tampering).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { COLLECTIONS } from '../src/constants/index.js';
import {
  createEntity, getEntity, updateEntitySection, filterEntityVisibility,
  createRelation, endRelation, getEntityGraph,
  issueClaim, verifyClaim, revokeClaim, getPublicKey,
  appendLedger, listLedger, verifyChain, canonicalJson, sha256Hex,
  type CinActor,
} from '../src/cin/index.js';

const actor: CinActor = { actorId: 'esan', scope: 'user', tenantId: null };

let fake: ReturnType<typeof createFakeDb>;
beforeEach(() => { fake = createFakeDb(); setTestDb(fake.db); });

describe('CIN entity graph', () => {
  it('creates a living entity with a signing key and ledger record', async () => {
    const { entity, publicKeyPem } = await createEntity(actor, {
      entityType: 'person', name: 'Ehsan Rahimi',
      sections: { identity: { data: { fullName: 'Ehsan Rahimi' }, visibility: 'private' } },
    });
    expect(entity.entityId).toMatch(/^cin_/);
    expect(publicKeyPem).toContain('PUBLIC KEY');
    expect(await getPublicKey(entity.entityId)).not.toBeNull();
    const ledger = await listLedger();
    expect(ledger.map((r) => r.recordType)).toEqual(['entity.created', 'key.created']);
  });

  it('versions sections on replacement and filters by visibility', async () => {
    const { entity } = await createEntity(actor, { entityType: 'person', name: 'P' });
    await updateEntitySection(actor, entity.entityId, 'skills', { list: ['ts'] }, 'public');
    const updated = await updateEntitySection(actor, entity.entityId, 'skills', { list: ['ts', 'zod'] });
    expect(updated.sections.skills.version).toBe(2);
    expect(updated.sections.skills.visibility).toBe('public'); // sticky visibility
    await updateEntitySection(actor, entity.entityId, 'financial', { net: 1 }, 'private');
    const full = await getEntity(entity.entityId, { includePrivate: true });
    const publicView = filterEntityVisibility(full!, { includePrivate: false });
    expect(Object.keys(publicView.sections)).toEqual(['skills']);
  });

  it('enforces relation endpoint existence and duplicate-active guard', async () => {
    const a = (await createEntity(actor, { entityType: 'person', name: 'A' })).entity;
    const b = (await createEntity(actor, { entityType: 'organization', name: 'B Corp' })).entity;
    await expect(createRelation(actor, { fromEntityId: a.entityId, toEntityId: 'cin_missing', relationType: 'member_of' })).rejects.toThrow('not found');
    const rel = await createRelation(actor, { fromEntityId: a.entityId, toEntityId: b.entityId, relationType: 'member_of', role: 'founder' });
    await expect(createRelation(actor, { fromEntityId: a.entityId, toEntityId: b.entityId, relationType: 'member_of' })).rejects.toThrow('already exists');
    await endRelation(actor, rel.relationId);
    // after ending, a new edge of the same type is allowed again
    await createRelation(actor, { fromEntityId: a.entityId, toEntityId: b.entityId, relationType: 'member_of' });
    const graph = await getEntityGraph(a.entityId, { includePrivate: true });
    expect(graph!.relations).toHaveLength(1); // only active edges
    expect(graph!.neighbors[0]!.name).toBe('B Corp');
  });
});

describe('CIN verifiable claims', () => {
  it('issues a signed claim that verifies, and fails after revocation', async () => {
    const issuer = (await createEntity(actor, { entityType: 'organization', name: 'University' })).entity;
    const subject = (await createEntity(actor, { entityType: 'person', name: 'Student' })).entity;
    const claim = await issueClaim({
      issuerEntityId: issuer.entityId, subjectEntityId: subject.entityId,
      claimType: 'education.degree', payload: { degree: 'MSc', field: 'AI' },
    });
    const v1 = await verifyClaim(claim.claimId);
    expect(v1.valid).toBe(true);
    expect(v1.checks).toEqual({ signature: true, notExpired: true, notRevoked: true, payloadMatchesHash: true });

    await revokeClaim(claim.claimId, 'issued in error');
    const v2 = await verifyClaim(claim.claimId);
    expect(v2.valid).toBe(false);
    expect(v2.reason).toContain('revoked');
  });

  it('detects payload tampering (selective-disclosure hash) and expiry', async () => {
    const issuer = (await createEntity(actor, { entityType: 'organization', name: 'Employer' })).entity;
    const subject = (await createEntity(actor, { entityType: 'person', name: 'Worker' })).entity;
    const claim = await issueClaim({
      issuerEntityId: issuer.entityId, subjectEntityId: subject.entityId,
      claimType: 'employment.role', payload: { role: 'engineer' },
    });
    // tamper with the stored payload directly
    await fake.db.collection(COLLECTIONS.CIN_CLAIMS).updateOne({ claimId: claim.claimId }, { $set: { payload: { role: 'CEO' } } });
    const v = await verifyClaim(claim.claimId);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain('payload');

    const expired = await issueClaim({
      issuerEntityId: issuer.entityId, subjectEntityId: subject.entityId,
      claimType: 'access.badge', expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const ve = await verifyClaim(expired.claimId);
    expect(ve.valid).toBe(false);
    expect(ve.reason).toBe('expired');
  });

  it('cannot issue for an issuer without a key', async () => {
    await expect(issueClaim({ issuerEntityId: 'cin_nokey', subjectEntityId: 'cin_x', claimType: 't' })).rejects.toThrow('no active signing key');
  });
});

describe('CIN ledger (tamper-evident chain)', () => {
  it('canonicalJson is key-order independent', () => {
    expect(sha256Hex(canonicalJson({ b: 1, a: { d: 2, c: [1, 2] } })))
      .toBe(sha256Hex(canonicalJson({ a: { c: [1, 2], d: 2 }, b: 1 })));
  });

  it('chains records and verifies an intact chain', async () => {
    await appendLedger({ recordType: 'entity.created', refId: 'x1', summary: 'one' });
    await appendLedger({ recordType: 'entity.created', refId: 'x2', summary: 'two' });
    await appendLedger({ recordType: 'entity.created', refId: 'x3', summary: 'three' });
    const records = await listLedger();
    expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(records[0]!.prevHash).toBe('GENESIS');
    expect(records[1]!.prevHash).toBe(records[0]!.hash);
    const check = await verifyChain();
    expect(check.ok).toBe(true);
    expect(check.length).toBe(3);
    expect(check.headHash).toBe(records[2]!.hash);
  });

  it('detects tampering anywhere in the chain', async () => {
    await appendLedger({ recordType: 'entity.created', refId: 'y1', summary: 'a' });
    await appendLedger({ recordType: 'claim.issued', refId: 'y2', summary: 'b' });
    await appendLedger({ recordType: 'claim.revoked', refId: 'y3', summary: 'c' });
    // mutate the middle record's data behind the ledger's back
    await fake.db.collection(COLLECTIONS.CIN_LEDGER).updateOne({ seq: 1 }, { $set: { summary: 'FORGED' } });
    const check = await verifyChain();
    expect(check.ok).toBe(false);
    expect(check.brokenAtSeq).toBe(1);
    expect(check.reason).toContain('tampered');
  });
});
