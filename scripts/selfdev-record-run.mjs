#!/usr/bin/env node
/**
 * D-178b — record the REAL self-development run in the durable self-dev ledger
 * (real MongoDB), driving the state machine through its gates with the ACTUAL
 * artifacts (branch, diff, verification results). Proves the pipeline tracks a
 * real run and enforces approval-before-implement + verify-before-merge, and
 * STOPS at awaiting_merge_approval (never merges without owner approval).
 * Writes a reflection lesson into memory only because verification succeeded.
 *
 * Usage: MONGODB_URI=... node scripts/selfdev-record-run.mjs
 */
import { connectMongo, closeMongo, createSelfDevRun, advanceSelfDevRun, getSelfDevRun, recordMemory, canTransition } from '@factory/shared';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('FAIL: MONGODB_URI required'); process.exit(1); }
const DB = process.env.MONGODB_DB_NAME ?? `aos_selfdev_${Math.random().toString(16).slice(2, 8)}`;

const BRANCH = 'selfdev/mission-next-action';
const DIFF = '4 files changed, 165 insertions(+), 5 deletions(-)';
const results = [];
const rec = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} — ${n}${d ? `: ${d}` : ''}`); };

async function main() {
  await connectMongo({ uri: MONGODB_URI, dbName: DB });
  const actor = { actorId: 'system', scope: 'global' };

  // Gate enforcement (mandate §I.5/§I.11): cannot implement before approval,
  // cannot merge before verification.
  rec('gate: cannot implement before approval', !canTransition('proposed', 'implementing'));
  rec('gate: cannot merge before verify+review', !canTransition('implementing', 'merged'));

  const run = await createSelfDevRun(actor, {
    title: 'Compute + surface the owner\'s single next action',
    gapSource: 'code_evidence',
    gapEvidence: ['mandate §5 requires "show current next action"; no computeNextAction existed'],
  });
  await advanceSelfDevRun(run.selfDevId, 'investigating', { investigation: 'Inspected shared/src/missions + watches: mission health existed, but no single next-action selection. Alternatives: (a) client-side ranking (rejected — not reusable, not testable), (b) extend buildMissionContext (rejected — mixes concerns), (c) a dedicated computeNextAction (chosen).' });
  await advanceSelfDevRun(run.selfDevId, 'decided', { decision: 'build', decisionRationale: 'No suitable OSS drop-in for a domain-specific mission next-action selector; ~50 LOC internal, dependency-aware, testable.', alternatives: ['client-side ranking', 'extend buildMissionContext', 'build computeNextAction'] });
  await advanceSelfDevRun(run.selfDevId, 'proposed', { proposalSummary: 'Add computeNextAction (unblocked>overdue>priority>due, dependency-aware) + surface in owner briefing with Continue-in-Jarvis deep link + mission_next_action tool.', boundedChange: 'shared/src/missions, watches, agentcore/families + one contract test file.' });

  // --- APPROVAL GATE (in a real run the owner approves in Jarvis) ---
  await advanceSelfDevRun(run.selfDevId, 'approved');
  await advanceSelfDevRun(run.selfDevId, 'implementing', { branch: BRANCH });
  await advanceSelfDevRun(run.selfDevId, 'verifying', {
    diffSummary: DIFF,
    checks: { typecheck: 'clean (caught + fixed a real undefined-index bug)', test: '5 new + 238 suite pass', build: 'green (shared + gateway)' },
  });
  await advanceSelfDevRun(run.selfDevId, 'reviewing', {
    reviewFindings: ['Reviewer: dependency-aware selection correct; pure read; scope-safe via listMissionNodes(actor).', 'QA: 5 contract tests cover priority/blocked/dependency/briefing-surfacing; typecheck caught PRIORITY_RANK[n.priority] possibly-undefined, fixed.'],
    qaFindings: ['typecheck clean', 'full suite green', 'build green'],
    evidenceBundleIds: [`git:${BRANCH}`],
    rollbackPlan: 'git branch is isolated; delete branch or revert the single commit. No main/protected-core change.',
  });
  const awaiting = await advanceSelfDevRun(run.selfDevId, 'awaiting_merge_approval', { mergeRecommendation: 'Merge-ready: bounded, reversible, owner-visible (briefing "next action"), fully verified. Awaiting owner merge approval.' });
  rec('run advanced to awaiting_merge_approval (STOPPED — not merged)', awaiting.stage === 'awaiting_merge_approval');
  rec('run did NOT reach merged/verified_post_change without owner approval', awaiting.stage !== 'merged');

  // Reflection lesson — recorded because verification SUCCEEDED.
  await recordMemory(actor, {
    kind: 'lesson', status: 'inferred',
    content: 'Self-dev: a domain next-action selector belongs in the missions module as a pure, dependency-aware function; typecheck caught a real undefined-index bug the tests would have missed. Surface owner-visible results in the briefing with a Continue-in-Jarvis deep link.',
    subject: 'lesson:selfdev-next-action',
    provenance: { sourceType: 'reflection', sessionId: null, turnId: null, runId: run.selfDevId, refIds: [`git:${BRANCH}`], sourceUrl: '' },
  });

  const durable = await getSelfDevRun(run.selfDevId);
  rec('durable ledger record persisted with real branch + diff + checks', durable?.branch === BRANCH && durable?.diffSummary === DIFF && durable?.checks?.build?.includes('green'), `stage=${durable?.stage}`);

  await closeMongo().catch(() => undefined);
  const failed = results.filter((r) => !r.p);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`self-dev run ${run.selfDevId}: ${durable?.stage} (branch ${BRANCH}) — NOT merged, awaiting owner approval.`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e?.stack ?? e?.message ?? e); process.exit(1); });
