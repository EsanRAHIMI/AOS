/**
 * D-188 — the assistant must know who the owner is.
 *
 * The failure being fixed: a profile holding full name, national id, passport
 * number, birth date and military status was on file, and Jarvis answered
 * "no personal data is recorded" — truthfully, because its turn context was
 * assembled from memory, missions and the transcript and never touched the CIN
 * entity. These tests pin both halves of the fix: the identity block exists,
 * and it does NOT ship identifier/health values into every prompt.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { createEntity, updateEntitySection, createDocument, buildOwnerIdentityContext } from '../src/cin/index.js';

const actor = { actorId: 'esan', scope: 'user' as const, tenantId: null };

beforeEach(() => { setTestDb(createFakeDb().db); });

async function seedOwner() {
  const { entity } = await createEntity(actor, { entityType: 'person', name: 'Ehsan Rahimi', tags: ['owner'] });
  await updateEntitySection(actor, entity.entityId, 'identity', {
    full_name_fa: 'احسان رحیمی',
    full_name_en: 'EHSAN RAHIMI',
    national_id: '0080225225',
    passport_no: '97818863',
    birth_date: '1988-04-11',
    nationality: 'Iranian',
    military_status: 'exempt_permanent',
  }, 'private');
  await updateEntitySection(actor, entity.entityId, 'financial', { bank_name: 'Bank Melli', iban: 'IR000000000000' }, 'private');
  return entity;
}

describe('owner identity context', () => {
  it('returns nothing usable when no entity exists — and does not throw', async () => {
    const ctx = await buildOwnerIdentityContext();
    expect(ctx.entityId).toBeNull();
    expect(ctx.text).toBe('');
  });

  it('tells the assistant who the owner is and what is on file', async () => {
    const entity = await seedOwner();
    const ctx = await buildOwnerIdentityContext();

    expect(ctx.entityId).toBe(entity.entityId);
    expect(ctx.text).toContain('OWNER IDENTITY');
    expect(ctx.text).toContain('Ehsan Rahimi');
    expect(ctx.text).toContain('احسان رحیمی');
    expect(ctx.text).toContain('nationality=Iranian');
    expect(ctx.text).toContain('military_status=exempt_permanent');
    // The entity id is included so the agent can fetch the rest with a tool.
    expect(ctx.text).toContain(entity.entityId);
    expect(ctx.sectionCount).toBe(2);
  });

  it('names sensitive fields as recorded WITHOUT putting their values in the prompt', async () => {
    await seedOwner();
    const ctx = await buildOwnerIdentityContext();

    // The assistant must know these exist…
    expect(ctx.text).toContain('national_id');
    expect(ctx.text).toContain('passport_no');
    expect(ctx.text).toContain('recorded, fetch with cin_entity_get');
    // …but the actual identifiers must not travel to a model on every turn.
    expect(ctx.text).not.toContain('0080225225');
    expect(ctx.text).not.toContain('97818863');
  });

  it('withholds whole sensitive sections while still admitting they exist', async () => {
    await seedOwner();
    const ctx = await buildOwnerIdentityContext();
    expect(ctx.text).toContain('financial');
    expect(ctx.text).not.toContain('IR000000000000');
    expect(ctx.text).not.toContain('Bank Melli');
  });

  it('always includes document deadlines in full — that is the actionable part', async () => {
    const entity = await seedOwner();
    await createDocument({ actorId: 'esan' }, {
      ownerEntityId: entity.entityId, title: 'پاسپورت', docType: 'identity',
      expiresAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
    });
    await createDocument({ actorId: 'esan' }, {
      ownerEntityId: entity.entityId, title: 'قرارداد کاری', docType: 'contract',
    });

    const ctx = await buildOwnerIdentityContext();
    expect(ctx.documentCount).toBe(2);
    expect(ctx.text).toContain('پاسپورت');
    expect(ctx.text).toContain('expires');
    expect(ctx.text).toContain('no expiry');
  });

  it('reports an empty profile honestly rather than inventing one', async () => {
    await createEntity(actor, { entityType: 'person', name: 'Bare Owner', tags: ['owner'] });
    const ctx = await buildOwnerIdentityContext();
    expect(ctx.text).toContain('none filled yet');
    expect(ctx.text).toContain('documents: none registered');
    expect(ctx.sectionCount).toBe(0);
  });
});
