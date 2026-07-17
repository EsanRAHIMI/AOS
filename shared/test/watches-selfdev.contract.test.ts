/**
 * K2 D-177 — Proactive watches + owner briefing + self-dev state-machine.
 * Watch firings dedup (no repeated alerts on unchanged issues); briefing is
 * built from REAL mission state and is honestly empty when nothing exists;
 * self-dev pipeline enforces approval-before-implement and
 * verify-before-merge gates.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import { createWatch, fireWatch, listRecentFirings, buildOwnerBriefing, briefingDedupKey, type WatchActor } from '../src/watches/index.js';
import { createMissionNode, type MissionActor } from '../src/missions/index.js';
import { createSelfDevRun, advanceSelfDevRun, canTransition } from '../src/selfdev/index.js';

const actor: WatchActor = { actorId: 'esan', scope: 'user', tenantId: null };
const mActor: MissionActor = { actorId: 'esan', scope: 'user', tenantId: null };

describe('proactive watches — dedup', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('a watch does not re-fire on an unchanged dedup key, but does fire on a changed one', async () => {
    const w = await createWatch(actor, { kind: 'overdue_commitments', title: 'Overdue watch' });
    const first = await fireWatch(actor, w, { headline: '2 overdue', dedupKey: 'k1' });
    expect(first).not.toBeNull();
    const w2 = { ...w, lastDedupKey: 'k1' };
    const dup = await fireWatch(actor, w2, { headline: '2 overdue', dedupKey: 'k1' });
    expect(dup).toBeNull(); // unchanged — suppressed
    const changed = await fireWatch(actor, w2, { headline: '3 overdue', dedupKey: 'k2' });
    expect(changed).not.toBeNull();
    expect(await listRecentFirings(actor)).toHaveLength(2);
  });
});

describe('owner briefing v2 — grounded, honest-empty', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('is honestly empty when no real state exists', async () => {
    const b = await buildOwnerBriefing(mActor, { overdueTasks: [], pendingApprovals: [], openDecisions: [], recentResearch: [], selfDevProposals: [] });
    expect(b.empty).toBe(true);
    expect(b.headline).toMatch(/موردی برای گزارش نیست|Nothing to report/);
  });

  it('references real mission priorities when they exist', async () => {
    const v = await createMissionNode(mActor, { nodeType: 'vision', title: 'Vision' });
    const o = await createMissionNode(mActor, { nodeType: 'strategic_objective', title: 'Objective A', parentId: v.node.nodeId });
    const p = await createMissionNode(mActor, { nodeType: 'program', title: 'Prog', parentId: o.node.nodeId });
    await createMissionNode(mActor, { nodeType: 'mission', title: 'Ship the thing', parentId: p.node.nodeId, priority: 'critical' });
    const b = await buildOwnerBriefing(mActor, { overdueTasks: [], pendingApprovals: ['deploy X'], openDecisions: [], recentResearch: [], selfDevProposals: [] });
    expect(b.empty).toBe(false);
    expect(JSON.stringify(b)).toMatch(/Ship the thing|Objective A/);
    expect(b.decisionsNeeded.join(' ')).toContain('deploy X');
    // dedup key is stable for identical state.
    const b2 = await buildOwnerBriefing(mActor, { overdueTasks: [], pendingApprovals: ['deploy X'], openDecisions: [], recentResearch: [], selfDevProposals: [] });
    expect(briefingDedupKey(b)).toBe(briefingDedupKey(b2));
  });
});

describe('self-development pipeline gates', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('cannot implement before approval, or merge before verification', () => {
    expect(canTransition('proposed', 'implementing')).toBe(false); // must be approved first
    expect(canTransition('proposed', 'approved')).toBe(true);
    expect(canTransition('approved', 'implementing')).toBe(true);
    expect(canTransition('implementing', 'merged')).toBe(false); // must verify+review first
    expect(canTransition('reviewing', 'awaiting_merge_approval')).toBe(true);
    expect(canTransition('awaiting_merge_approval', 'merged')).toBe(true);
  });

  it('advancing through an illegal transition throws', async () => {
    const run = await createSelfDevRun({ actorId: 'system', scope: 'global' }, { title: 'Add X', gapSource: 'code_evidence' });
    await advanceSelfDevRun(run.selfDevId, 'investigating');
    await advanceSelfDevRun(run.selfDevId, 'decided', { decision: 'build', decisionRationale: 'no oss fit' });
    await advanceSelfDevRun(run.selfDevId, 'proposed', { proposalSummary: 'bounded change' });
    await expect(advanceSelfDevRun(run.selfDevId, 'implementing')).rejects.toThrow(/illegal transition/);
    await advanceSelfDevRun(run.selfDevId, 'approved');
    const impl = await advanceSelfDevRun(run.selfDevId, 'implementing', { branch: 'selfdev/add-x' });
    expect(impl.stage).toBe('implementing');
    expect(impl.branch).toBe('selfdev/add-x');
  });
});
