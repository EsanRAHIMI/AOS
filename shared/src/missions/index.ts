/**
 * Mission & Objective System (K2, D-177; mandate §D).
 *
 * One durable hierarchy in ONE collection (`mission_nodes`) with a nodeType
 * discriminator, so the whole tree is queryable, scope-safe and cheap to
 * traverse: vision → strategic_objective → program → mission → plan → task
 * → action. Evidence/outcome/lesson attach by reference, not duplication.
 *
 * Jarvis creates and updates this hierarchy through governed tools
 * (../agentcore/families.ts) — natural language in, structured editable
 * state out, persisted and followed over time. Anti-duplication: creation
 * tools check for an ACTIVE node with the same normalized title under the
 * same parent before inserting (mandate: no endless duplicate tasks).
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';
import { contentTokens } from '../memory2/index.js';

export const MissionNodeType = z.enum(['vision', 'strategic_objective', 'program', 'mission', 'plan', 'task', 'action']);
export type MissionNodeType = z.infer<typeof MissionNodeType>;

/** Parent-type each node type may attach to (tree integrity by construction). */
export const NODE_PARENT: Record<MissionNodeType, MissionNodeType | null> = {
  vision: null,
  strategic_objective: 'vision',
  program: 'strategic_objective',
  mission: 'program',
  plan: 'mission',
  task: 'plan',
  action: 'task',
};

export const MissionNodeStatus = z.enum(['draft', 'active', 'blocked', 'stalled', 'completed', 'cancelled']);
export type MissionNodeStatus = z.infer<typeof MissionNodeStatus>;

export const MissionNodeSchema = z.object({
  nodeId: z.string(),
  nodeType: MissionNodeType,
  parentId: z.string().nullable().default(null),
  title: z.string().min(1),
  description: z.string().default(''),
  status: MissionNodeStatus.default('active'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  /** Measurable success criteria — free text but explicitly separate. */
  successCriteria: z.array(z.string()).default([]),
  timeHorizon: z.string().default(''),      // e.g. '90d', '2026-Q4'
  dueAt: z.string().nullable().default(null),
  nextReviewAt: z.string().nullable().default(null),
  dependencies: z.array(z.string()).default([]),   // nodeIds
  risks: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  responsibleActor: z.string().default('owner'),
  linkedResearchIds: z.array(z.string()).default([]),
  linkedDecisionMemoryIds: z.array(z.string()).default([]),
  linkedSessionId: z.string().nullable().default(null),
  linkedTaskIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  outcome: z.string().default(''),
  lesson: z.string().default(''),
  blockedReason: z.string().default(''),
  progressNote: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  completedAt: z.string().nullable().default(null),
}).merge(ScopeFieldsSchema);
export type MissionNode = z.infer<typeof MissionNodeSchema>;

const nodes = () => collection<MissionNode>(COLLECTIONS.MISSION_NODES);

export interface MissionActor {
  actorId: string;
  scope: 'global' | 'user';
  tenantId?: string | null;
}

function scopeFilter(actor: MissionActor): Record<string, unknown> {
  if (actor.scope === 'user') return { scope: 'user', createdBy: actor.actorId };
  return { scope: 'global' };
}

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export function normalizedTitleKey(title: string): string {
  return contentTokens(title).sort().join(' ');
}

export interface CreateNodeArgs {
  nodeType: MissionNodeType;
  title: string;
  description?: string;
  parentId?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  successCriteria?: string[];
  timeHorizon?: string;
  dueAt?: string | null;
  nextReviewAt?: string | null;
  dependencies?: string[];
  risks?: string[];
  assumptions?: string[];
  linkedSessionId?: string | null;
  status?: MissionNodeStatus;
}

/** Create with parent-type validation + duplicate guard. Returns the existing
 *  node (with `duplicate:true`) when an active same-titled sibling exists. */
export async function createMissionNode(actor: MissionActor, args: CreateNodeArgs, publish?: Publish): Promise<{ node: MissionNode; duplicate: boolean }> {
  const expectedParent = NODE_PARENT[args.nodeType];
  let parent: MissionNode | null = null;
  if (args.parentId) {
    parent = await nodes().findOne({ ...scopeFilter(actor), nodeId: args.parentId } as never);
    if (!parent) throw new Error(`parent node ${args.parentId} not found in scope`);
    if (expectedParent && parent.nodeType !== expectedParent) {
      throw new Error(`a ${args.nodeType} must attach to a ${expectedParent}, got ${parent.nodeType}`);
    }
  } else if (expectedParent) {
    throw new Error(`a ${args.nodeType} requires a parent ${expectedParent} (pass parentId)`);
  }

  // Anti-duplication (mandate §D): same normalized title + same parent + active.
  const key = normalizedTitleKey(args.title);
  const siblings = await nodes().find({ ...scopeFilter(actor), nodeType: args.nodeType, parentId: args.parentId ?? null, status: { $in: ['draft', 'active', 'blocked', 'stalled'] } } as never).toArray();
  const dup = siblings.find((s) => normalizedTitleKey(s.title) === key);
  if (dup) return { node: dup, duplicate: true };

  const now = nowIso();
  const node = MissionNodeSchema.parse({
    nodeId: genId('mn'),
    nodeType: args.nodeType,
    parentId: args.parentId ?? null,
    title: args.title,
    description: args.description ?? '',
    status: args.status ?? 'active',
    priority: args.priority ?? 'normal',
    successCriteria: args.successCriteria ?? [],
    timeHorizon: args.timeHorizon ?? '',
    dueAt: args.dueAt ?? null,
    nextReviewAt: args.nextReviewAt ?? null,
    dependencies: args.dependencies ?? [],
    risks: args.risks ?? [],
    assumptions: args.assumptions ?? [],
    linkedSessionId: args.linkedSessionId ?? null,
    createdAt: now,
    updatedAt: now,
    scope: actor.scope,
    ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    createdBy: actor.actorId,
    visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await nodes().insertOne(node);
  await publish?.({ type: EVENT_TYPES.MISSION_CREATED, taskId: null, payload: { nodeId: node.nodeId, nodeType: node.nodeType, title: node.title.slice(0, 120), message: `${node.nodeType} created: ${node.title.slice(0, 80)}` } });
  return { node, duplicate: false };
}

export interface UpdateNodeArgs {
  nodeId: string;
  patch: Partial<Pick<MissionNode, 'title' | 'description' | 'status' | 'priority' | 'successCriteria' | 'dueAt' | 'nextReviewAt' | 'dependencies' | 'risks' | 'assumptions' | 'blockedReason' | 'progressNote' | 'outcome' | 'lesson' | 'timeHorizon'>>;
}

export async function updateMissionNode(actor: MissionActor, args: UpdateNodeArgs, publish?: Publish): Promise<MissionNode | null> {
  const now = nowIso();
  const set: Record<string, unknown> = { ...args.patch, updatedAt: now };
  if (args.patch.status === 'completed') set.completedAt = now;
  const res = await nodes().findOneAndUpdate(
    { ...scopeFilter(actor), nodeId: args.nodeId } as never,
    { $set: set } as never,
    { returnDocument: 'after' },
  );
  if (res) await publish?.({ type: EVENT_TYPES.MISSION_UPDATED, taskId: null, payload: { nodeId: args.nodeId, patch: Object.keys(args.patch), message: `${res.nodeType} updated: ${res.title.slice(0, 80)}` } });
  return res ?? null;
}

export async function getMissionNode(actor: MissionActor, nodeId: string): Promise<MissionNode | null> {
  return nodes().findOne({ ...scopeFilter(actor), nodeId } as never, { projection: { _id: 0 } as never });
}

export async function listMissionChildren(actor: MissionActor, parentId: string | null, nodeType?: MissionNodeType): Promise<MissionNode[]> {
  const filter: Record<string, unknown> = { ...scopeFilter(actor), parentId };
  if (nodeType) filter.nodeType = nodeType;
  return nodes().find(filter as never, { projection: { _id: 0 } as never }).sort({ priority: -1, updatedAt: -1 }).toArray();
}

export async function listMissionNodes(actor: MissionActor, opts: { nodeTypes?: MissionNodeType[]; statuses?: MissionNodeStatus[]; limit?: number } = {}): Promise<MissionNode[]> {
  const filter: Record<string, unknown> = { ...scopeFilter(actor) };
  if (opts.nodeTypes?.length) filter.nodeType = { $in: opts.nodeTypes };
  if (opts.statuses?.length) filter.status = { $in: opts.statuses };
  return nodes().find(filter as never, { projection: { _id: 0 } as never }).sort({ updatedAt: -1 }).limit(opts.limit ?? 200).toArray();
}

/** The whole subtree under a node (breadth-first, bounded). */
export async function getMissionTree(actor: MissionActor, rootId: string, maxNodes = 300): Promise<MissionNode[]> {
  const root = await getMissionNode(actor, rootId);
  if (!root) return [];
  const out: MissionNode[] = [root];
  let frontier = [rootId];
  while (frontier.length && out.length < maxNodes) {
    const children = await nodes().find({ ...scopeFilter(actor), parentId: { $in: frontier } } as never, { projection: { _id: 0 } as never }).toArray();
    out.push(...children);
    frontier = children.map((c) => c.nodeId);
  }
  return out;
}

/** Stall/overdue/review detection (mandate §D + §H watches read this). */
export interface MissionHealth {
  overdue: MissionNode[];
  reviewDue: MissionNode[];
  stalled: MissionNode[];
  blocked: MissionNode[];
}

export async function assessMissionHealth(actor: MissionActor, opts: { stalledAfterDays?: number } = {}): Promise<MissionHealth> {
  const now = Date.now();
  const stalledMs = (opts.stalledAfterDays ?? 10) * 86_400_000;
  const active = await nodes().find({ ...scopeFilter(actor), status: { $in: ['active', 'blocked', 'stalled'] } } as never, { projection: { _id: 0 } as never }).toArray();
  const overdue = active.filter((n) => n.dueAt && Date.parse(n.dueAt) < now && n.status !== 'completed');
  const reviewDue = active.filter((n) => n.nextReviewAt && Date.parse(n.nextReviewAt) < now);
  const stalled = active.filter((n) => n.status !== 'blocked' && now - Date.parse(n.updatedAt) > stalledMs && (n.nodeType === 'mission' || n.nodeType === 'task' || n.nodeType === 'plan'));
  const blocked = active.filter((n) => n.status === 'blocked');
  // Persist honest stalled status so the tree reflects reality.
  for (const s of stalled.filter((n) => n.status === 'active')) {
    await nodes().updateOne({ nodeId: s.nodeId }, { $set: { status: 'stalled', updatedAt: nowIso() } });
    s.status = 'stalled';
  }
  return { overdue, reviewDue, stalled, blocked };
}

/** Compact context lines for the Jarvis packet — how today's work connects
 *  upward (mandate: explain how tasks connect to a larger objective). */
export async function buildMissionContext(actor: MissionActor, opts: { limit?: number } = {}): Promise<{ lines: string[]; text: string }> {
  const active = await listMissionNodes(actor, { statuses: ['active', 'blocked', 'stalled'], limit: 120 });
  const byId = new Map(active.map((n) => [n.nodeId, n]));
  const chainOf = (n: MissionNode): string => {
    const parts = [n.title];
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    let hops = 0;
    while (cur && hops < 4) { parts.unshift(cur.title); cur = cur.parentId ? byId.get(cur.parentId) : undefined; hops += 1; }
    return parts.join(' → ');
  };
  const interesting = active
    .filter((n) => n.nodeType === 'mission' || n.nodeType === 'task' || n.nodeType === 'strategic_objective')
    .sort((a, b) => (b.priority === 'critical' ? 2 : b.priority === 'high' ? 1 : 0) - (a.priority === 'critical' ? 2 : a.priority === 'high' ? 1 : 0))
    .slice(0, opts.limit ?? 10);
  const lines = interesting.map((n) => {
    const flags = [n.status !== 'active' ? n.status.toUpperCase() : '', n.dueAt && Date.parse(n.dueAt) < Date.now() ? 'OVERDUE' : ''].filter(Boolean).join(',');
    return `- [${n.nodeType}${flags ? `/${flags}` : ''}] ${chainOf(n)}${n.dueAt ? ` (due ${n.dueAt.slice(0, 10)})` : ''} (id:${n.nodeId})`;
  });
  return { lines, text: lines.join('\n') };
}
