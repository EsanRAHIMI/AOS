#!/usr/bin/env node
/**
 * Phase AF.2 smoke — Full Domain Canvas Expansion & Jarvis-Guided Interaction.
 *
 * Checks the pure-logic guarantees this phase depends on:
 *  1. Every one of the nine zones has a real domain-specific renderer
 *     (src/lib/domainCanvas.ts's DOMAIN_RENDERERS manifest, no silent
 *     fallback to the generic bullet list).
 *  2. buildDomainInsight() produces a distinct, real-data-driven message
 *     per zone/status combo — not one generic string reused everywhere —
 *     and returns null (silence) for 'live' zones with nothing to flag.
 *  3. Phase AF.1's Focus Row priority guarantee still holds (rerun).
 *
 * Since these modules live in dashboard-web (not the shared package build),
 * compile them standalone first:
 *   cd services/dashboard-web && node_modules/.bin/tsc --module commonjs \
 *     --target es2020 --outDir /tmp/aos-af2-check --skipLibCheck \
 *     src/lib/domainCanvas.ts src/lib/domainInsight.ts src/lib/focus.ts
 * Then run this from repo root: node scripts/phaseaf2-domain-canvas-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let domainCanvas, domainInsight, focus;
try {
  domainCanvas = require('/tmp/aos-af2-check/domainCanvas.js');
  domainInsight = require('/tmp/aos-af2-check/domainInsight.js');
  focus = require('/tmp/aos-af2-check/focus.js');
} catch (e) {
  console.error('Could not load compiled AF.2 lib modules — compile them first (see header comment).');
  console.error(e.message);
  process.exit(1);
}
const { ZONE_IDS, DOMAIN_RENDERERS, hasDomainRenderer } = domainCanvas;
const { buildDomainInsight } = domainInsight;
const { buildFocusItems } = focus;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.2 — Domain Canvas Expansion smoke\n');

console.log('— Every zone has a real renderer (no silent generic fallback) —');
check('ZONE_IDS has all 9 zones', ZONE_IDS.length === 9, JSON.stringify(ZONE_IDS));
for (const id of ZONE_IDS) {
  check(`"${id}" has a domain renderer`, hasDomainRenderer(id) && typeof DOMAIN_RENDERERS[id] === 'string' && DOMAIN_RENDERERS[id].length > 0, DOMAIN_RENDERERS[id]);
}
check('No zone maps to itself as its own generic fallback', Object.values(DOMAIN_RENDERERS).every((v) => v.endsWith('.tsx')));

console.log('\n— domainInsight: distinct, real-data-driven per zone —');
const mkZone = (over) => ({ zoneId: 'health', status: 'setup_needed', headline: 'h', setupHint: 'hint', jarvisCommand: 'do it', metrics: [], ...over });

check('live zone → null (silence, nothing to flag)', buildDomainInsight(mkZone({ status: 'live' })) === null);

const healthAttention = buildDomainInsight(mkZone({ zoneId: 'health', status: 'attention', metrics: [{ label: 'concerns', value: '2', tone: 'warn' }] }));
check('health/attention mentions the real concern count', healthAttention?.text.includes('2'), healthAttention?.text);
check('health/attention is kind=blocker', healthAttention?.kind === 'blocker');

const financeAttention = buildDomainInsight(mkZone({ zoneId: 'finance', status: 'attention' }));
check('finance/attention text differs from health/attention text (not one generic string)', financeAttention?.text !== healthAttention?.text);

const growthOpportunity = buildDomainInsight(mkZone({ zoneId: 'growth', status: 'setup_needed', metrics: [{ label: 'goals', value: '3', tone: 'ok' }] }));
check('growth with goals but status setup_needed → opportunity framing', growthOpportunity?.kind === 'opportunity', JSON.stringify(growthOpportunity));

const growthNoGoals = buildDomainInsight(mkZone({ zoneId: 'growth', status: 'setup_needed', metrics: [{ label: 'goals', value: '0', tone: 'warn' }] }));
check('growth with no goals → setup_needed framing (not opportunity)', growthNoGoals?.kind === 'setup_needed');

const presenceInsight = buildDomainInsight(mkZone({ zoneId: 'presence', status: 'not_configured' }));
check('presence/not_configured is kind=not_configured', presenceInsight?.kind === 'not_configured');

const systemsInsight = buildDomainInsight(mkZone({ zoneId: 'systems', status: 'attention', metrics: [{ label: 'incidents', value: '1', tone: 'err' }] }));
check('systems/attention names it a technical blocker, not the user priority', systemsInsight?.text.includes('not a change to your stated priority'), systemsInsight?.text);

console.log('\n— Focus Row priority guarantee still holds (AF.1 regression) —');
const withPriority = buildFocusItems({ primaryPriority: 'fix Jarvis', activeBlockers: ['x unhealthy'], systemWarnings: ['1 issue'], recommendedNextActions: [] }, 0);
check('Priority is still always first', withPriority[0]?.kind === 'priority');
check('System warnings still never displace a stated priority', !withPriority.some((i) => i.kind === 'warning'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
