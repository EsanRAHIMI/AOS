#!/usr/bin/env node
/**
 * Phase AF.4.3 smoke — Live Activity module rebuilt as a grouped operation
 * feed (`lib/operationFeed.ts`'s `buildOperationFeed`).
 *
 * Checks the pure-logic guarantee this fix depends on: one visual item per
 * real operation, correctly grouped by its stable identity, patched in
 * place rather than duplicated — the exact bug reported ("too many lines,
 * repeated items for the same operation").
 *
 * Compile first (from services/dashboard-web):
 *   node_modules/.bin/tsc --module commonjs --target es2020 \
 *     --outDir /tmp/aos-af4-3-check --skipLibCheck src/lib/operationFeed.ts
 * Then from repo root: node scripts/phaseaf4-3-live-activity-feed-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let operationFeed;
try {
  operationFeed = require('/tmp/aos-af4-3-check/operationFeed.js');
} catch (e) {
  console.error('Could not load compiled AF.4.3 lib module — compile it first (see header comment).');
  console.error(e.message);
  process.exit(1);
}
const { buildOperationFeed } = operationFeed;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.4.3 — Live Activity operation feed smoke\n');

console.log('— A session + its own lifecycle events collapse into ONE card, not five —');
const session = { runtimeSessionId: 'rs_1', goal: 'Investigate unhealthy services', status: 'waiting_approval', nextAction: '', reportSummary: '', composedReply: '', startedAt: '2026-07-09T10:00:00.000Z', completedAt: null };
const approval = { permissionId: 'perm_1', runtimeSessionId: 'rs_1', prompt: 'Infrastructure approval requested', riskLevel: 'high', createdAt: '2026-07-09T10:00:05.000Z' };
const events1 = [
  { type: 'operator.session.started', message: 'Operator session started', createdAt: '2026-07-09T10:00:00.000Z', runtimeSessionId: 'rs_1', taskId: null, permissionId: null, source: 'gateway-api' },
  { type: 'operator.approval.requested', message: 'Approval needed: infra change', createdAt: '2026-07-09T10:00:04.000Z', runtimeSessionId: 'rs_1', taskId: null, permissionId: 'perm_1', source: 'gateway-api' },
  { type: 'task.created', message: 'Task created: repair unhealthy service', createdAt: '2026-07-09T10:00:06.000Z', runtimeSessionId: 'rs_1', taskId: 'task_1', permissionId: null, source: 'gateway-api' },
];
const feed1 = buildOperationFeed({ sessions: [session], approvals: [approval], tasks: [], events: events1 }, 30);
check('Exactly ONE item produced for the session + its 3 events + its approval', feed1.length === 1, `got ${feed1.length}`);
check('The one item carries the real session goal as its title', feed1[0]?.title === 'Investigate unhealthy services', feed1[0]?.title);
check('Status reflects the merged pending approval ("waiting approval")', feed1[0]?.status === 'waiting approval', feed1[0]?.status);
check('meta carries the real risk level', feed1[0]?.meta === 'high risk', feed1[0]?.meta);
check('Low-level events are folded into history, not separate rows', feed1[0]?.history.length > 0, JSON.stringify(feed1[0]?.history));
check('latestMessage reflects the most recent real event, not the oldest', feed1[0]?.latestMessage.includes('repair unhealthy service') || feed1[0]?.latestMessage.includes('Task created'), feed1[0]?.latestMessage);

console.log('\n— A kernel task is a separate operation from an unrelated session —');
const task = { taskId: 'task_2', goal: 'Nightly backup', status: 'running', createdAt: '2026-07-09T09:00:00.000Z', updatedAt: '2026-07-09T09:05:00.000Z' };
const feed2 = buildOperationFeed({ sessions: [session], approvals: [], tasks: [task], events: [] }, 30);
check('Session and unrelated task produce two distinct cards', feed2.length === 2, `got ${feed2.length}`);
check('Task card links to real Mission Control', feed2.find((i) => i.key === 'task:task_2')?.href === '/tasks/task_2');

console.log('\n— Repeated/duplicate events for the same operation never create extra cards —');
const dupeEvents = [...events1, { ...events1[0] }, { ...events1[1] }];
const feed3 = buildOperationFeed({ sessions: [session], approvals: [approval], tasks: [], events: dupeEvents }, 30);
check('Duplicate events still collapse to ONE card', feed3.length === 1, `got ${feed3.length}`);

console.log('\n— An event with no session/task identity is its own standalone card (not dropped, not merged wrongly) —');
const standaloneEvent = { type: 'reality.ingested', message: 'Reality ingested: health_state (+1/0)', createdAt: '2026-07-09T11:00:00.000Z', runtimeSessionId: null, taskId: null, permissionId: null, source: 'gateway-api' };
const feed4 = buildOperationFeed({ sessions: [], approvals: [], tasks: [], events: [standaloneEvent] }, 30);
check('Standalone event becomes exactly one card', feed4.length === 1, `got ${feed4.length}`);
check('Standalone event card is kind=event', feed4[0]?.kind === 'event', feed4[0]?.kind);

console.log('\n— A completed session shows a real completed/failed result, not a stale "waiting" status —');
const completed = { runtimeSessionId: 'rs_3', goal: 'Check the whole system', status: 'completed', nextAction: '', reportSummary: 'All services healthy.', composedReply: 'Everything looks healthy right now.', startedAt: '2026-07-09T08:00:00.000Z', completedAt: '2026-07-09T08:02:00.000Z' };
const feed5 = buildOperationFeed({ sessions: [completed], approvals: [], tasks: [], events: [] }, 30);
check('Completed session status is "completed"', feed5[0]?.status === 'completed', feed5[0]?.status);
check('Completed session tone is ok', feed5[0]?.statusTone === 'ok', feed5[0]?.statusTone);
check('Completed session shows the real composed reply as latestMessage', feed5[0]?.latestMessage === 'Everything looks healthy right now.', feed5[0]?.latestMessage);

console.log('\n— Ordering: most recently updated operation is first —');
const older = { runtimeSessionId: 'rs_old', goal: 'Older goal', status: 'completed', nextAction: '', reportSummary: '', composedReply: '', startedAt: '2026-07-09T01:00:00.000Z', completedAt: '2026-07-09T01:01:00.000Z' };
const newer = { runtimeSessionId: 'rs_new', goal: 'Newer goal', status: 'completed', nextAction: '', reportSummary: '', composedReply: '', startedAt: '2026-07-09T05:00:00.000Z', completedAt: '2026-07-09T05:01:00.000Z' };
const feed6 = buildOperationFeed({ sessions: [older, newer], approvals: [], tasks: [], events: [] }, 30);
check('Newest-updated operation sorts first', feed6[0]?.title === 'Newer goal', JSON.stringify(feed6.map((i) => i.title)));

console.log('\n— Cap respected —');
const many = Array.from({ length: 10 }, (_, i) => ({ runtimeSessionId: `rs_many_${i}`, goal: `Goal ${i}`, status: 'completed', nextAction: '', reportSummary: '', composedReply: '', startedAt: `2026-07-09T0${i}:00:00.000Z`, completedAt: `2026-07-09T0${i}:01:00.000Z` }));
const feed7 = buildOperationFeed({ sessions: many, approvals: [], tasks: [], events: [] }, 5);
check('Feed respects the requested cap', feed7.length === 5, `got ${feed7.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
