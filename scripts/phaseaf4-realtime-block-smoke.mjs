#!/usr/bin/env node
/**
 * Phase AF.4 smoke — Realtime Block Runtime, Fast Jarvis Response &
 * Operation Lifecycle Fix.
 *
 * Checks the pure-logic guarantees this phase depends on, against the real
 * compiled block-invalidation manifest (not a re-implementation of it):
 *  1. Every domain action's real ingestKind maps to a real, non-empty (or
 *     honestly empty) block list — no fabricated block ids.
 *  2. Health/finance ingest kinds specifically invalidate their own zone
 *     block, per the "block-level, not whole-page" requirement.
 *  3. Next-action / opportunity decisions invalidate their real zones plus
 *     'focus' (so the Focus Row reflects the change too).
 *  4. Every real backend SSE event this phase publishes (reality.ingested,
 *     next_action.decided, opportunity.decided) has a real block mapping —
 *     confirms LiveEvents' cross-tab bridge isn't silently a no-op.
 *  5. BLOCK_IDS is the exact 12-block manifest the product brief specifies.
 *  6. AF.1/AF.2/AF.3 regressions stay green (via the existing AF.3 script's
 *     own regression block, run separately — see run-all note below).
 *
 * Compile first (from services/dashboard-web):
 *   node_modules/.bin/tsc --module commonjs --target es2020 \
 *     --outDir /tmp/aos-af4-check --skipLibCheck \
 *     src/lib/realtimeBlocks.ts src/lib/domainActions.ts
 * Then from repo root: node scripts/phaseaf4-realtime-block-smoke.mjs
 *
 * NOT covered here (documented, not silently skipped):
 *  - The duplicate-approval-message fix (OperatorConsole's
 *    `announcedApprovalIdRef` dedup) is React-state-driven and has no pure
 *    function to import — verified by code review (see decision-log D-116)
 *    and requires a manual UI check (see final report §9).
 *  - `refresh()`'s actual network merge behavior (UniverseProvider) needs a
 *    browser/DOM environment and is out of scope for a Node smoke script.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let realtimeBlocks, domainActions;
try {
  realtimeBlocks = require('/tmp/aos-af4-check/realtimeBlocks.js');
  domainActions = require('/tmp/aos-af4-check/domainActions.js');
} catch (e) {
  console.error('Could not load compiled AF.4 lib modules — compile them first (see header comment).');
  console.error(e.message);
  process.exit(1);
}
const { BLOCK_IDS, blocksForIngestKind, blocksForNextActionDecision, blocksForOpportunityDecision, blocksForTaskCreated, blocksForApprovalDecision, blocksForEventType } = realtimeBlocks;
const { DOMAIN_ACTIONS } = domainActions;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.4 — Realtime Block Runtime smoke\n');

console.log('— Block manifest matches the product brief\'s 12 named blocks —');
const EXPECTED_BLOCKS = ['presence', 'focus', 'health', 'daily', 'life', 'finance', 'ventures', 'growth', 'opportunities', 'systems', 'channels', 'live-pulse'];
check('BLOCK_IDS has exactly the 12 specified blocks', JSON.stringify([...BLOCK_IDS].sort()) === JSON.stringify([...EXPECTED_BLOCKS].sort()), JSON.stringify(BLOCK_IDS));

console.log('\n— Every real add_data action\'s ingestKind resolves to a real block list —');
for (const zoneId of Object.keys(DOMAIN_ACTIONS)) {
  for (const a of DOMAIN_ACTIONS[zoneId]) {
    if (a.kind !== 'add_data') continue;
    const blocks = blocksForIngestKind(a.ingestKind);
    check(`"${a.id}" (${a.ingestKind}) → blocksForIngestKind returns an array`, Array.isArray(blocks), JSON.stringify(blocks));
    for (const b of blocks) check(`  "${a.ingestKind}" block "${b}" is a real BLOCK_ID`, BLOCK_IDS.includes(b), b);
  }
}

console.log('\n— Health/finance ingest invalidates its own zone block (block-level, not whole-page) —');
check('health_state → includes "health"', blocksForIngestKind('health_state').includes('health'), JSON.stringify(blocksForIngestKind('health_state')));
check('finance_item → includes "finance"', blocksForIngestKind('finance_item').includes('finance'), JSON.stringify(blocksForIngestKind('finance_item')));
check('life_item → includes "life" (and "daily" for the overdue check)', blocksForIngestKind('life_item').includes('life') && blocksForIngestKind('life_item').includes('daily'));

console.log('\n— Next-action / opportunity decisions invalidate their real zone + focus —');
check('blocksForNextActionDecision includes "daily" and "focus"', blocksForNextActionDecision().includes('daily') && blocksForNextActionDecision().includes('focus'), JSON.stringify(blocksForNextActionDecision()));
check('blocksForOpportunityDecision includes "opportunities" and "focus"', blocksForOpportunityDecision().includes('opportunities') && blocksForOpportunityDecision().includes('focus'), JSON.stringify(blocksForOpportunityDecision()));
check('blocksForTaskCreated includes "systems"', blocksForTaskCreated().includes('systems'), JSON.stringify(blocksForTaskCreated()));
check('blocksForApprovalDecision includes "systems"', blocksForApprovalDecision().includes('systems'), JSON.stringify(blocksForApprovalDecision()));

console.log('\n— Every real published SSE event this phase adds has a real block mapping (LiveEvents bridge is not a no-op) —');
const REAL_NEW_EVENTS = ['reality.ingested', 'next_action.decided', 'opportunity.decided'];
for (const type of REAL_NEW_EVENTS) {
  const blocks = blocksForEventType(type);
  check(`"${type}" → blocksForEventType returns a non-empty array`, Array.isArray(blocks) && blocks.length > 0, JSON.stringify(blocks));
}
check('An unknown event type honestly returns an empty array (no fabricated mapping)', JSON.stringify(blocksForEventType('made.up.event')) === '[]');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
