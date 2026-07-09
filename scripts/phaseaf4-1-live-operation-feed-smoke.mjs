#!/usr/bin/env node
/**
 * Phase AF.4.1 smoke — Persistent Live Operation Feed, Hydration Fix &
 * Approval UX Hardening.
 *
 * Checks the pure-logic guarantees this phase depends on:
 *  1. Every new/newly-instrumented operator lifecycle event
 *     (operator.session.started, operator.approval.decided,
 *     operator.tool.failed) maps to the 'live-pulse' block — the whole
 *     point of the fix is that these events actually invalidate something.
 *  2. blocksForApprovalDecision()/blocksForSessionStarted() include
 *     'live-pulse'.
 *  3. `eventDedupeKey`/`mergeDedupedEvents` (the pure logic behind "no
 *     duplicate operation events" — requirement #10) behave correctly: same
 *     event delivered twice (snapshot + SSE) dedupes to one; genuinely
 *     different events don't collide; result stays chronologically ordered
 *     and capped.
 *  4. Structural hydration-safety check: `PresenceBar.tsx` no longer
 *     computes elapsed time directly in its render body (no local
 *     `Date.now()` call) and does render `<RelativeTime`; `RelativeTime.tsx`
 *     only computes the real label inside `useEffect`, never in the
 *     component's synchronous render path — verified by source inspection
 *     since a true SSR/hydration mismatch can't be reproduced by a Node
 *     script without a browser.
 *  5. AF.1/AF.2/AF.3/AF.4 regressions stay green (run separately — see
 *     run-all note below).
 *
 * Compile first (from services/dashboard-web):
 *   node_modules/.bin/tsc --module commonjs --target es2020 \
 *     --outDir /tmp/aos-af4-1-check --skipLibCheck \
 *     src/lib/realtimeBlocks.ts src/lib/eventDedupe.ts
 * Then from repo root: node scripts/phaseaf4-1-live-operation-feed-smoke.mjs
 *
 * NOT covered here (documented, not silently skipped — see final report):
 *  - The live-state endpoint's actual Mongo query behavior needs a live
 *    database; this sandbox has no mongod. Verified by code review + the
 *    gateway-api typecheck instead.
 *  - `OperatorConsole`'s mount-time reload / optimistic approval buttons are
 *    React-state-driven with no pure function to unit test — verified by
 *    code review; needs a manual UI pass (see final report §10).
 *  - True SSR/hydration reproduction needs a real Next.js render pass in a
 *    browser or `next build` + server start, unavailable in this sandbox.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

let realtimeBlocks, eventDedupe;
try {
  realtimeBlocks = require('/tmp/aos-af4-1-check/realtimeBlocks.js');
  eventDedupe = require('/tmp/aos-af4-1-check/eventDedupe.js');
} catch (e) {
  console.error('Could not load compiled AF.4.1 lib modules — compile them first (see header comment).');
  console.error(e.message);
  process.exit(1);
}
const { BLOCK_IDS, blocksForEventType, blocksForApprovalDecision, blocksForSessionStarted } = realtimeBlocks;
const { eventDedupeKey, mergeDedupedEvents } = eventDedupe;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.4.1 — Live Operation Feed smoke\n');

console.log('— New/newly-instrumented operator lifecycle events invalidate the live feed —');
for (const type of ['operator.session.started', 'operator.approval.decided', 'operator.tool.failed']) {
  const blocks = blocksForEventType(type);
  check(`"${type}" → includes 'live-pulse'`, blocks.includes('live-pulse'), JSON.stringify(blocks));
  for (const b of blocks) check(`  "${type}" block "${b}" is a real BLOCK_ID`, BLOCK_IDS.includes(b), b);
}

console.log('\n— Approval decision / session start affect the live feed —');
check('blocksForApprovalDecision includes live-pulse', blocksForApprovalDecision().includes('live-pulse'), JSON.stringify(blocksForApprovalDecision()));
check('blocksForSessionStarted includes live-pulse', blocksForSessionStarted().includes('live-pulse'), JSON.stringify(blocksForSessionStarted()));

console.log('\n— Event dedupe: same event via snapshot + SSE renders once —');
const base = { type: 'operator.approval.decided', createdAt: '2026-07-09T10:00:00.000Z', runtimeSessionId: 'rs_1', taskId: null, permissionId: 'perm_1' };
const dup = { ...base };
check('Identical events produce the same dedupe key', eventDedupeKey(base) === eventDedupeKey(dup));
const merged1 = mergeDedupedEvents([base], [dup]);
check('mergeDedupedEvents collapses an exact duplicate to one entry', merged1.length === 1, `got ${merged1.length}`);

console.log('\n— Event dedupe: genuinely different events both survive —');
const different = { type: 'operator.approval.decided', createdAt: '2026-07-09T10:05:00.000Z', runtimeSessionId: 'rs_2', taskId: null, permissionId: 'perm_2' };
const merged2 = mergeDedupedEvents([base], [different]);
check('Two different real events both survive the merge', merged2.length === 2, `got ${merged2.length}`);
check('Merge result is newest-first', merged2[0].runtimeSessionId === 'rs_2', JSON.stringify(merged2.map((e) => e.runtimeSessionId)));

console.log('\n— Event dedupe: result stays capped at the requested limit —');
const many = Array.from({ length: 10 }, (_, i) => ({ type: 'task.created', createdAt: `2026-07-09T10:${String(i).padStart(2, '0')}:00.000Z`, runtimeSessionId: null, taskId: `t_${i}`, permissionId: null }));
const merged3 = mergeDedupedEvents([], many, 5);
check('mergeDedupedEvents respects the limit', merged3.length === 5, `got ${merged3.length}`);

console.log('\n— Structural hydration-safety check (source inspection) —');
const presenceBarSrc = readFileSync(join(repoRoot, 'services/dashboard-web/src/components/PresenceBar.tsx'), 'utf8');
const relativeTimeSrc = readFileSync(join(repoRoot, 'services/dashboard-web/src/components/RelativeTime.tsx'), 'utf8');
check('PresenceBar.tsx no longer calls Date.now() directly (the reported hydration bug)', !presenceBarSrc.includes('Date.now()'), 'still present');
check('PresenceBar.tsx renders <RelativeTime', presenceBarSrc.includes('<RelativeTime'), 'not found');
check('RelativeTime.tsx computes the label inside useEffect, not the render body', /useEffect\(\(\) => \{[\s\S]*?timeAgo\(/.test(relativeTimeSrc), 'timeAgo( not found inside a useEffect block');
const renderReturn = relativeTimeSrc.slice(relativeTimeSrc.lastIndexOf('return'));
check('RelativeTime.tsx render return does not call timeAgo() directly', !renderReturn.includes('timeAgo('), 'render body calls timeAgo() directly — would reintroduce the mismatch');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
