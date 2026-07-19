/**
 * CIN Entity Graph (CIN-1, D-179) — living identities for every kind of
 * actor in the network (proposal §4/§5/§7/§8): person, organization, city,
 * government, AI agent, robot, device, service.
 *
 * A living identity is NOT a static record: it is a set of versioned profile
 * SECTIONS, each with its own visibility, updated continuously and optionally
 * backed by verifiable claims (`attestedBy`). Typed relations connect
 * entities into one queryable civilizational graph.
 *
 * Every mutation appends to the CIN ledger (tamper-evident history).
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';
import { appendLedger } from './ledger.js';
import { createEntityKey } from './trust.js';

export const CinEntityType = z.enum([
  'person', 'organization', 'org_unit', 'city', 'region', 'government',
  'ai_agent', 'robot', 'device', 'service',
]);
export type CinEntityType = z.infer<typeof CinEntityType>;

export const CinSectionVisibility = z.enum(['private', 'restricted', 'network', 'public']);
export type CinSectionVisibility = z.infer<typeof CinSectionVisibility>;

/** Well-known section names (proposal §5/§7 checklists). `custom:*` allowed. */
export const CIN_KNOWN_SECTIONS = [
  'identity', 'contact', 'education', 'credentials', 'employment', 'skills',
  'financial', 'assets', 'legal', 'health_ref', 'memberships', 'achievements',
  'preferences', 'goals', 'capabilities', 'governance', 'operations',
] as const;

export const CinProfileSectionSchema = z.object({
  data: z.record(z.string(), z.unknown()).default({}),
  visibility: CinSectionVisibility.default('private'),
  version: z.number().int().positive().default(1),
  updatedAt: z.string(),
  updatedBy: z.string().default('owner'),
  /** claimIds in cin_claims that attest this section's content. */
  attestedBy: z.array(z.string()).default([]),
});
export type CinProfileSection = z.infer<typeof CinProfileSectionSchema>;

export const CinEntityStatus = z.enum(['active', 'suspended', 'archived']);

export const CinEntitySchema = z.object({
  entityId: z.string(),
  entityType: CinEntityType,
  name: z.string().min(1),
  displayName: z.string().default(''),
  status: CinEntityStatus.default('active'),
  sections: z.record(z.string(), CinProfileSectionSchema).default({}),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
}).merge(ScopeFieldsSchema);
export type CinEntity = z.infer<typeof CinEntitySchema>;

export const CinRelationType = z.enum([
  'member_of', 'owns', 'operates', 'governs', 'represents', 'delegates_to',
  'located_in', 'contracts_with', 'parent_of', 'connected_to',
]);
export type CinRelationType = z.infer<typeof CinRelationType>;

export const CinRelationSchema = z.object({
  relationId: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  relationType: CinRelationType,
  role: z.string().default(''),
  since: z.string().nullable().default(null),
  until: z.string().nullable().default(null),
  status: z.enum(['active', 'ended']).default('active'),
  attestingClaimId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CinRelation = z.infer<typeof CinRelationSchema>;

export interface CinActor { actorId: string; scope: 'global' | 'user' | 'tenant'; tenantId: string | null }

const entitiesCol = () => collection<CinEntity>(COLLECTIONS.CIN_ENTITIES);
const relationsCol = () => collection<CinRelation>(COLLECTIONS.CIN_RELATIONS);

export interface CreateEntityInput {
  entityType: CinEntityType;
  name: string;
  displayName?: string;
  tags?: string[];
  sections?: Record<string, { data: Record<string, unknown>; visibility?: CinSectionVisibility }>;
}

export async function createEntity(actor: CinActor, input: CreateEntityInput): Promise<{ entity: CinEntity; publicKeyPem: string }> {
  const now = nowIso();
  const sections: Record<string, CinProfileSection> = {};
  for (const [name, s] of Object.entries(input.sections ?? {})) {
    sections[name] = CinProfileSectionSchema.parse({ data: s.data, visibility: s.visibility ?? 'private', version: 1, updatedAt: now, updatedBy: actor.actorId });
  }
  const entity: CinEntity = CinEntitySchema.parse({
    entityId: genId('cin'),
    entityType: input.entityType,
    name: input.name,
    displayName: input.displayName ?? input.name,
    status: 'active',
    sections,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    scope: actor.scope,
    tenantId: actor.tenantId ?? undefined,
    createdBy: actor.actorId,
  });
  await entitiesCol().insertOne(entity as never);
  await appendLedger({
    recordType: 'entity.created', refId: entity.entityId, actorEntityId: actor.actorId,
    summary: `${entity.entityType} "${entity.name}" created`,
    data: { entityType: entity.entityType, name: entity.name },
  });
  // Every entity gets a signing key at birth — identity without trust is inert.
  const { publicKeyPem } = await createEntityKey(entity.entityId);
  return { entity, publicKeyPem };
}

/** Visibility filter: non-privileged readers only see network/public sections. */
export function filterEntityVisibility(entity: CinEntity, opts: { includePrivate: boolean }): CinEntity {
  if (opts.includePrivate) return entity;
  const sections: Record<string, CinProfileSection> = {};
  for (const [name, s] of Object.entries(entity.sections)) {
    if (s.visibility === 'network' || s.visibility === 'public') sections[name] = s;
  }
  return { ...entity, sections };
}

export async function getEntity(entityId: string, opts: { includePrivate: boolean } = { includePrivate: false }): Promise<CinEntity | null> {
  const doc = await entitiesCol().findOne({ entityId });
  return doc ? filterEntityVisibility(CinEntitySchema.parse(doc), opts) : null;
}

export async function listEntities(filter: { entityType?: CinEntityType; status?: string; q?: string } = {}): Promise<CinEntity[]> {
  const f: Record<string, unknown> = {};
  if (filter.entityType) f.entityType = filter.entityType;
  if (filter.status) f.status = filter.status;
  const docs = await entitiesCol().find(f).sort({ createdAt: -1 }).limit(500).toArray();
  let list = docs.map((d) => CinEntitySchema.parse(d));
  if (filter.q) {
    const q = filter.q.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)));
  }
  return list;
}

export async function updateEntitySection(
  actor: CinActor,
  entityId: string,
  sectionName: string,
  data: Record<string, unknown>,
  visibility?: CinSectionVisibility,
): Promise<CinEntity> {
  const doc = await entitiesCol().findOne({ entityId });
  if (!doc) throw new Error(`entity ${entityId} not found`);
  const entity = CinEntitySchema.parse(doc);
  const prev = entity.sections[sectionName];
  const now = nowIso();
  // Sections are replaced WHOLE and version-incremented — no silent partial edits.
  const next: CinProfileSection = {
    data,
    visibility: visibility ?? prev?.visibility ?? 'private',
    version: (prev?.version ?? 0) + 1,
    updatedAt: now,
    updatedBy: actor.actorId,
    attestedBy: prev?.attestedBy ?? [],
  };
  await entitiesCol().updateOne({ entityId }, { $set: { [`sections.${sectionName}`]: next, updatedAt: now, updatedBy: actor.actorId } });
  await appendLedger({
    recordType: 'entity.section_updated', refId: entityId, actorEntityId: actor.actorId,
    summary: `section "${sectionName}" → v${next.version}`,
    data: { section: sectionName, version: next.version, visibility: next.visibility },
  });
  return { ...entity, sections: { ...entity.sections, [sectionName]: next }, updatedAt: now };
}

export async function setEntityStatus(actor: CinActor, entityId: string, status: z.infer<typeof CinEntityStatus>): Promise<void> {
  const res = await entitiesCol().updateOne({ entityId }, { $set: { status, updatedAt: nowIso(), updatedBy: actor.actorId } });
  if (!res.matchedCount) throw new Error(`entity ${entityId} not found`);
  await appendLedger({ recordType: 'entity.status_changed', refId: entityId, actorEntityId: actor.actorId, summary: `status → ${status}`, data: { status } });
}

export interface CreateRelationInput {
  fromEntityId: string;
  toEntityId: string;
  relationType: CinRelationType;
  role?: string;
  since?: string | null;
  attestingClaimId?: string | null;
}

export async function createRelation(actor: CinActor, input: CreateRelationInput): Promise<CinRelation> {
  const [from, to] = await Promise.all([
    entitiesCol().findOne({ entityId: input.fromEntityId }),
    entitiesCol().findOne({ entityId: input.toEntityId }),
  ]);
  if (!from) throw new Error(`from-entity ${input.fromEntityId} not found`);
  if (!to) throw new Error(`to-entity ${input.toEntityId} not found`);
  const dup = await relationsCol().findOne({ fromEntityId: input.fromEntityId, toEntityId: input.toEntityId, relationType: input.relationType, status: 'active' });
  if (dup) throw new Error(`active ${input.relationType} relation already exists between these entities`);
  const now = nowIso();
  const relation: CinRelation = CinRelationSchema.parse({
    relationId: genId('cinrel'),
    fromEntityId: input.fromEntityId,
    toEntityId: input.toEntityId,
    relationType: input.relationType,
    role: input.role ?? '',
    since: input.since ?? now,
    until: null,
    status: 'active',
    attestingClaimId: input.attestingClaimId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await relationsCol().insertOne(relation as never);
  await appendLedger({
    recordType: 'relation.created', refId: relation.relationId, actorEntityId: actor.actorId,
    summary: `${input.fromEntityId} —${input.relationType}→ ${input.toEntityId}`,
    data: { relationType: input.relationType, role: relation.role },
  });
  return relation;
}

export async function endRelation(actor: CinActor, relationId: string): Promise<void> {
  const now = nowIso();
  const res = await relationsCol().updateOne({ relationId, status: 'active' }, { $set: { status: 'ended', until: now, updatedAt: now } });
  if (!res.matchedCount) throw new Error(`active relation ${relationId} not found`);
  await appendLedger({ recordType: 'relation.ended', refId: relationId, actorEntityId: actor.actorId, summary: 'relation ended', data: {} });
}

export interface EntityGraphView {
  entity: CinEntity;
  relations: CinRelation[];
  neighbors: Array<Pick<CinEntity, 'entityId' | 'entityType' | 'name' | 'displayName' | 'status'>>;
}

/** 1-hop neighborhood: the entity, its active edges (both directions), and
 *  lightweight summaries of the entities on the other end. */
export async function getEntityGraph(entityId: string, opts: { includePrivate: boolean } = { includePrivate: false }): Promise<EntityGraphView | null> {
  const entity = await getEntity(entityId, opts);
  if (!entity) return null;
  const rels = await relationsCol().find({ $or: [{ fromEntityId: entityId }, { toEntityId: entityId }], status: 'active' }).limit(500).toArray();
  const relations = rels.map((r) => CinRelationSchema.parse(r));
  const neighborIds = [...new Set(relations.flatMap((r) => [r.fromEntityId, r.toEntityId]).filter((id) => id !== entityId))];
  const neighbors: EntityGraphView['neighbors'] = [];
  for (const id of neighborIds) {
    const doc = await entitiesCol().findOne({ entityId: id });
    if (doc) {
      const e = CinEntitySchema.parse(doc);
      neighbors.push({ entityId: e.entityId, entityType: e.entityType, name: e.name, displayName: e.displayName, status: e.status });
    }
  }
  return { entity, relations, neighbors };
}
