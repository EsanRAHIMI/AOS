/**
 * D-188 — the assistant needs tools that answer "about me".
 *
 * The cin family had entity/claim/ledger tools but no way to resolve the OWNER
 * and nothing at all for documents, so even a willing agent could not look up
 * the profile it was being asked about. These tests execute the real
 * registered tools against a seeded graph.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { buildCoreToolFamilies } from '../src/agentcore/families.js';
import { createEntity, updateEntitySection, createDocument } from '../src/cin/index.js';

const actor = { actorId: 'owner', scope: 'user' as const, tenantId: null };
const ctx = {
  actorId: 'owner', role: 'owner' as const, isOwner: true, scope: 'user' as const,
  tenantId: null, userId: 'owner', runId: 'run_1', sessionId: 'sess_1',
};

beforeEach(() => { setTestDb(createFakeDb().db); });

async function seed() {
  const { entity } = await createEntity(actor, { entityType: 'person', name: 'Ehsan Rahimi', tags: ['owner'] });
  await updateEntitySection(actor, entity.entityId, 'identity', {
    full_name_fa: 'احسان رحیمی', national_id: '0080225225', nationality: 'Iranian',
  }, 'private');
  await createDocument({ actorId: 'owner' }, {
    ownerEntityId: entity.entityId, title: 'پاسپورت', docType: 'identity',
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  return entity;
}

describe('cin_me', () => {
  it('is registered and resolves the owner without being told an id', async () => {
    const entity = await seed();
    const registry = buildCoreToolFamilies();
    const tool = registry.get('cin_me');
    expect(tool, 'cin_me must be registered').toBeTruthy();

    const res = await tool!.executor({}, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('Ehsan Rahimi');
    expect(res.summary).toContain('nationality=Iranian');
    expect((res.data as { entityId: string }).entityId).toBe(entity.entityId);
  });

  it('does not leak identifiers through the tool either', async () => {
    await seed();
    const res = await buildCoreToolFamilies().get('cin_me')!.executor({}, ctx);
    expect(res.summary).toContain('national_id');       // it exists…
    expect(res.summary).not.toContain('0080225225');    // …but not its value
  });

  it('says so plainly when there is no owner entity yet', async () => {
    const res = await buildCoreToolFamilies().get('cin_me')!.executor({}, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('No owner entity');
  });
});

describe('cin_documents_list', () => {
  it('lists documents with the expiry that makes them actionable', async () => {
    await seed();
    const res = await buildCoreToolFamilies().get('cin_documents_list')!.executor({}, ctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain('پاسپورت');
    expect(res.summary).toContain('expires');
    expect((res.data as unknown[]).length).toBe(1);
  });

  it('defaults to the owner when no entity id is supplied', async () => {
    const entity = await seed();
    const explicit = await buildCoreToolFamilies().get('cin_documents_list')!.executor({ ownerEntityId: entity.entityId }, ctx);
    const implicit = await buildCoreToolFamilies().get('cin_documents_list')!.executor({}, ctx);
    expect(implicit.summary).toBe(explicit.summary);
  });

  it('is a read-only tool — reading your own papers must never need approval', async () => {
    const registry = buildCoreToolFamilies();
    for (const name of ['cin_me', 'cin_documents_list']) {
      const def = registry.get(name)!.definition;
      expect(def.requiresApproval, name).toBe(false);
      expect(def.policyCategory, name).toBe('read_only');
    }
  });
});
