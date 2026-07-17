/**
 * K2 D-177 — Mission/objective hierarchy proofs (mandate §D): durable
 * vision→objective→program→mission→plan→task tree, parent-type integrity,
 * duplicate guard (no endless duplicate tasks), stall detection, upward
 * context ("how today's task connects to a bigger objective").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  createMissionNode, updateMissionNode, listMissionNodes, getMissionTree,
  assessMissionHealth, buildMissionContext, type MissionActor,
} from '../src/missions/index.js';

const actor: MissionActor = { actorId: 'esan', scope: 'user', tenantId: null };

async function seedTree() {
  const vision = await createMissionNode(actor, { nodeType: 'vision', title: 'AOS becomes my daily operating system' });
  const obj = await createMissionNode(actor, { nodeType: 'strategic_objective', title: 'Usable Jarvis in 90 days', parentId: vision.node.nodeId, timeHorizon: '90d', priority: 'high' });
  const prog = await createMissionNode(actor, { nodeType: 'program', title: 'Intelligence core', parentId: obj.node.nodeId });
  const mission = await createMissionNode(actor, { nodeType: 'mission', title: 'Ship persistent Jarvis', parentId: prog.node.nodeId, priority: 'critical' });
  const plan = await createMissionNode(actor, { nodeType: 'plan', title: 'Agent loop + memory', parentId: mission.node.nodeId });
  const task = await createMissionNode(actor, { nodeType: 'task', title: 'Build the tool registry', parentId: plan.node.nodeId });
  return { vision, obj, prog, mission, plan, task };
}

describe('mission hierarchy', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('builds a full vision→task chain with parent-type integrity', async () => {
    const t = await seedTree();
    const tree = await getMissionTree(actor, t.vision.node.nodeId);
    expect(tree.map((n) => n.nodeType)).toEqual(['vision', 'strategic_objective', 'program', 'mission', 'plan', 'task']);
  });

  it('rejects an invalid parent type', async () => {
    const vision = await createMissionNode(actor, { nodeType: 'vision', title: 'V' });
    await expect(createMissionNode(actor, { nodeType: 'task', title: 'orphan task', parentId: vision.node.nodeId })).rejects.toThrow(/must attach to a plan/);
  });

  it('requires a parent for every non-vision node', async () => {
    await expect(createMissionNode(actor, { nodeType: 'mission', title: 'no parent' })).rejects.toThrow(/requires a parent/);
  });

  it('duplicate guard: same-titled active sibling is reused, not duplicated (no endless duplicate tasks)', async () => {
    const { plan } = await seedTree();
    const first = await createMissionNode(actor, { nodeType: 'task', title: 'Write the docs', parentId: plan.node.nodeId });
    const again = await createMissionNode(actor, { nodeType: 'task', title: '  write   the DOCS ', parentId: plan.node.nodeId });
    expect(again.duplicate).toBe(true);
    expect(again.node.nodeId).toBe(first.node.nodeId);
    const tasks = await listMissionNodes(actor, { nodeTypes: ['task'] });
    expect(tasks.filter((n) => n.parentId === plan.node.nodeId && /docs/i.test(n.title))).toHaveLength(1);
  });

  it('completing a node stamps completedAt and status', async () => {
    const { task } = await seedTree();
    const updated = await updateMissionNode(actor, { nodeId: task.node.nodeId, patch: { status: 'completed', outcome: 'registry shipped' } });
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeTruthy();
  });

  it('stall detection flips a long-untouched active task to stalled', async () => {
    const { task } = await seedTree();
    const { collection } = await import('../src/db/index.js');
    const { COLLECTIONS } = await import('../src/constants/index.js');
    await collection(COLLECTIONS.MISSION_NODES).updateOne({ nodeId: task.node.nodeId }, { $set: { updatedAt: new Date(Date.now() - 1000 * 3600 * 24 * 30).toISOString() } });
    const health = await assessMissionHealth(actor, { stalledAfterDays: 10 });
    expect(health.stalled.some((n) => n.nodeId === task.node.nodeId)).toBe(true);
  });

  it('mission context explains upward linkage (task → ... → objective)', async () => {
    await seedTree();
    const ctx = await buildMissionContext(actor, { limit: 10 });
    expect(ctx.text).toContain('→'); // a chain is rendered
    expect(ctx.text).toMatch(/Ship persistent Jarvis|Build the tool registry|Usable Jarvis/);
  });

  it('scope isolation: another user sees none of these nodes', async () => {
    await seedTree();
    const other: MissionActor = { actorId: 'other', scope: 'user', tenantId: null };
    expect(await listMissionNodes(other)).toHaveLength(0);
  });
});
