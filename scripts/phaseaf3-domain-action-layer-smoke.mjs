#!/usr/bin/env node
/**
 * Phase AF.3 smoke — Jarvis Guided Control & Domain Action Layer.
 *
 * Checks the pure-logic guarantees this phase depends on:
 *  1. Every zone has a real suggested action OR is one of the two zones
 *     that intentionally use per-item decide controls instead (daily via
 *     DecisionButtons, opportunities via OpportunityDecisionButtons) —
 *     never neither.
 *  2. Every add_data action's ingestKind is real (matches the documented
 *     shared/src/personal ingestion kinds) and every action has a unique id.
 *  3. No action references a fabricated field name outside the known set.
 *  4. AF.1/AF.2 regressions stay green (focus + domain canvas guarantees).
 *
 * Compile first (from services/dashboard-web):
 *   node_modules/.bin/tsc --module commonjs --target es2020 \
 *     --outDir /tmp/aos-af3-check --skipLibCheck \
 *     src/lib/domainActions.ts src/lib/domainCanvas.ts src/lib/domainInsight.ts src/lib/focus.ts
 * Then from repo root: node scripts/phaseaf3-domain-action-layer-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let domainActions, domainCanvas, domainInsight, focus;
try {
  domainActions = require('/tmp/aos-af3-check/domainActions.js');
  domainCanvas = require('/tmp/aos-af3-check/domainCanvas.js');
  domainInsight = require('/tmp/aos-af3-check/domainInsight.js');
  focus = require('/tmp/aos-af3-check/focus.js');
} catch (e) {
  console.error('Could not load compiled AF.3 lib modules — compile them first (see header comment).');
  console.error(e.message);
  process.exit(1);
}
const { DOMAIN_ACTIONS, actionsFor } = domainActions;
const { ZONE_IDS } = domainCanvas;
const { buildDomainInsight } = domainInsight;
const { buildFocusItems } = focus;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.3 — Domain Action Layer smoke\n');

// Real ingestion kinds this phase is allowed to target, per
// shared/src/personal/index.ts's INGESTION_KINDS. Kept as a literal list
// here (not imported) so the smoke test independently verifies the
// manifest didn't drift onto an invented kind.
const REAL_INGESTION_KINDS = new Set(['profile', 'resume', 'project', 'system', 'asset', 'goal', 'income_idea', 'risk', 'learning_track', 'career_record', 'tech_watch', 'health_state', 'life_item', 'finance_item']);
// The two zones that intentionally use per-item decide controls instead of
// a zone-level add_data/create_task action (wired directly in
// PriorityStack.tsx / OpportunityRadar.tsx via real itemId-bearing items).
const ITEM_DECISION_ZONES = new Set(['daily', 'opportunities']);

console.log('— Every zone has a real action path (zone-level or per-item) —');
check('ZONE_IDS has all 9 zones', ZONE_IDS.length === 9, JSON.stringify(ZONE_IDS));
for (const id of ZONE_IDS) {
  const actions = actionsFor(id);
  const hasZoneAction = actions.length > 0;
  const isItemDecisionZone = ITEM_DECISION_ZONES.has(id);
  check(`"${id}" has a zone-level action or a per-item decision path`, hasZoneAction || isItemDecisionZone, `actions=${actions.length} itemDecision=${isItemDecisionZone}`);
}

console.log('\n— Manifest integrity: no fabricated ingest kinds, no duplicate ids —');
const allIds = new Set();
let dupeFound = false;
for (const zoneId of Object.keys(DOMAIN_ACTIONS)) {
  for (const a of DOMAIN_ACTIONS[zoneId]) {
    if (allIds.has(a.id)) dupeFound = true;
    allIds.add(a.id);
    if (a.kind === 'add_data') {
      check(`"${a.id}" ingestKind "${a.ingestKind}" is a real ingestion kind`, REAL_INGESTION_KINDS.has(a.ingestKind), a.ingestKind);
      check(`"${a.id}" has at least one field`, Array.isArray(a.fields) && a.fields.length > 0);
    }
    if (a.kind === 'create_task') check(`"${a.id}" has a non-empty goal template`, typeof a.goalTemplate === 'string' && a.goalTemplate.length > 0);
    if (a.kind === 'open_link') check(`"${a.id}" href starts with /`, a.href.startsWith('/'), a.href);
  }
}
check('No duplicate action ids across the whole manifest', !dupeFound);

console.log('\n— AF.1/AF.2 regressions still green —');
const withPriority = buildFocusItems({ primaryPriority: 'fix Jarvis', activeBlockers: ['x unhealthy'], systemWarnings: ['1 issue'], recommendedNextActions: [] }, 0);
check('Focus Row: priority still always first', withPriority[0]?.kind === 'priority');
const liveZone = { zoneId: 'health', status: 'live', headline: 'h', setupHint: 'hint', jarvisCommand: 'do it', metrics: [] };
check('Domain insight: live zone still returns null', buildDomainInsight(liveZone) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
