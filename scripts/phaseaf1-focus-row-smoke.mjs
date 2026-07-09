#!/usr/bin/env node
/**
 * Phase AF.1 smoke — Focus Row priority ordering.
 *
 * `buildFocusItems()` (services/dashboard-web/src/lib/focus.ts) is the pure
 * logic behind the homepage Focus Row. This proves, at the unit level, the
 * exact structural guarantee the phase depends on: an explicit user-stated
 * priority is ALWAYS first, and generic system warnings can NEVER displace
 * it — only ever appearing when there is nothing else to show. This is the
 * same guarantee Phase AE.1 fixed in the answer-composition path; this test
 * proves it also holds in the new homepage Focus Row.
 *
 * Since this module lives in the dashboard-web Next.js app (not the shared
 * package build), this script expects it pre-compiled to plain JS via:
 *   node_modules/.bin/tsc --module commonjs --target es2020 \
 *     --outDir /tmp/aos-af1-check --skipLibCheck src/lib/focus.ts
 * (run from services/dashboard-web). Run this script from repo root:
 *   node scripts/phaseaf1-focus-row-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let buildFocusItems;
try {
  ({ buildFocusItems } = require('/tmp/aos-af1-check/focus.js'));
} catch (e) {
  console.error('Could not load compiled focus.js — compile it first (see header comment).');
  console.error(e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.1 — Focus Row priority ordering smoke\n');

console.log('— The real failed-conversation scenario: priority + noisy system warnings —');
const briefingWithPriority = {
  primaryPriority: 'اصلاح مغز Jarvis و صفحه اول AOS',
  activeBlockers: ['service-registry unhealthy', 'file-asset-service unhealthy'],
  systemWarnings: ['2 services unhealthy'],
  recommendedNextActions: ['Test the priority-memory fix end to end'],
};
const withPriority = buildFocusItems(briefingWithPriority, 0);
check('First item is the stated priority', withPriority[0]?.kind === 'priority', JSON.stringify(withPriority));
check('Priority detail matches exactly what the owner said (never paraphrased)', withPriority[0]?.detail === briefingWithPriority.primaryPriority);
check('Second item is a real blocker, not a system warning', withPriority[1]?.kind === 'blocker');
check('Row is capped at 3 items', withPriority.length <= 3);
check('System warnings never appear when a priority exists', !withPriority.some((i) => i.kind === 'warning'));

console.log('— No stated priority, but approvals pending —');
const withApprovals = buildFocusItems({ primaryPriority: '', activeBlockers: [], systemWarnings: ['1 incident'], recommendedNextActions: ['Review incident'] }, 2);
check('Approval item appears when pendingApprovals > 0', withApprovals.some((i) => i.kind === 'approval'), JSON.stringify(withApprovals));
check('Approval label is honest about the real count', withApprovals.find((i) => i.kind === 'approval')?.label.includes('2'));
check('System warning still does not appear while a recommendation exists', !withApprovals.some((i) => i.kind === 'warning'));

console.log('— Nothing at all except a system warning (last resort only) —');
const onlyWarning = buildFocusItems({ primaryPriority: '', activeBlockers: [], systemWarnings: ['registry unreachable'], recommendedNextActions: [] }, 0);
check('System warning surfaces ONLY when there is truly nothing else', onlyWarning.length === 1 && onlyWarning[0].kind === 'warning', JSON.stringify(onlyWarning));

console.log('— Null briefing (kernel unreachable) —');
const nullBriefing = buildFocusItems(null, 0);
check('No briefing + no approvals ⇒ empty row, never a fake placeholder item', nullBriefing.length === 0, JSON.stringify(nullBriefing));
const nullWithApprovals = buildFocusItems(null, 1);
check('Null briefing still surfaces a REAL approval count if one exists', nullWithApprovals.length === 1 && nullWithApprovals[0].kind === 'approval');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
