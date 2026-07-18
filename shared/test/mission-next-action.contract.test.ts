/**
 * D-178b (self-development run) — computeNextAction: the single highest-
 * priority actionable task across the mission hierarchy, surfaced in the owner
 * briefing with a Continue-in-Jarvis deep link (mandate §5/§7).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { createMissionNode, updateMissionNode, computeNextAction, type MissionActor } from '../src/missions/index.js';
import { buildOwnerBriefing } from '../src/watches/index.js';

const actor: MissionActor = { actorId: 'esan', scope: 'user', tenantId: null };

async function seed() {
  const v = await createMissionNode(actor, { nodeType: 'vision', title: 'Vision' });
  const o = await createMissionNode(actor, { nodeType: 'strategic_objective', title: 'Objective', parentId: v.node.nodeId });
  const pr = await createMissionNode(actor, { nodeType: 'program', title: 'Program', parentId: o.node.nodeId });
  const m = await createMissionNode(actor, { nodeType: 'mission', title: 'Mission', parentId: pr.node.nodeId });
  const pl = await createMissionNode(actor, { nodeType: 'plan', title: 'Plan', parentId: m.node.nodeId });
  return { plan: pl.node.nodeId };
}

describe('computeNextAction', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('returns null when there is no actionable task', async () => {
    await seed();
    expect(await computeNextAction(actor)).toBeNull();
  });

  it('picks the highest-priority unblocked task and reports its upward chain', async () => {
    const { plan } = await seed();
    await createMissionNode(actor, { nodeType: 'task', title: 'low task', parentId: plan, priority: 'low' });
    const hi = await createMissionNode(actor, { nodeType: 'task', title: 'critical task', parentId: plan, priority: 'critical' });
    const na = await computeNextAction(actor);
    expect(na?.node.nodeId).toBe(hi.node.nodeId);
    expect(na?.chain).toContain('Vision → Objective');
    expect(na?.chain).toContain('critical task');
    expect(na?.reason).toContain('critical priority');
  });

  it('prefers an unblocked normal task over a blocked critical one', async () => {
    const { plan } = await seed();
    const blocked = await createMissionNode(actor, { nodeType: 'task', title: 'blocked crit', parentId: plan, priority: 'critical' });
    await updateMissionNode(actor, { nodeId: blocked.node.nodeId, patch: { status: 'blocked', blockedReason: 'waiting' } });
    const ok = await createMissionNode(actor, { nodeType: 'task', title: 'doable normal', parentId: plan, priority: 'normal' });
    const na = await computeNextAction(actor);
    expect(na?.node.nodeId).toBe(ok.node.nodeId);
    expect(na?.reason).toContain('unblocked');
  });

  it('respects dependencies: a task whose dependency is incomplete ranks below a doable one', async () => {
    const { plan } = await seed();
    const dep = await createMissionNode(actor, { nodeType: 'task', title: 'prerequisite', parentId: plan, priority: 'normal' });
    const gated = await createMissionNode(actor, { nodeType: 'task', title: 'gated high', parentId: plan, priority: 'high' });
    await updateMissionNode(actor, { nodeId: gated.node.nodeId, patch: { dependencies: [dep.node.nodeId] } as never });
    const na = await computeNextAction(actor);
    // prerequisite (doable) should outrank the dependency-gated higher-priority task
    expect(na?.node.nodeId).toBe(dep.node.nodeId);
  });

  it('surfaces the next action + Continue-in-Jarvis deep link in the owner briefing', async () => {
    const { plan } = await seed();
    const t = await createMissionNode(actor, { nodeType: 'task', title: 'ship the thing', parentId: plan, priority: 'high' });
    const b = await buildOwnerBriefing(actor, { overdueTasks: [], pendingApprovals: [], openDecisions: [], recentResearch: [], selfDevProposals: [] }, 'en');
    expect(b.nextAction?.nodeId).toBe(t.node.nodeId);
    expect(b.nextAction?.continueInJarvis).toContain(`missionNodeId=${t.node.nodeId}`);
    expect(b.headline).toContain('ship the thing');
    expect(b.empty).toBe(false);
  });
});
