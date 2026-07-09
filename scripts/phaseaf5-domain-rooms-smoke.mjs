#!/usr/bin/env node
/**
 * Phase AF.5 smoke — "Command Universe follow-through": every zone must
 * link to its own dedicated room instead of a generic or mismatched page
 * (the exact bug documented in docs/living-command-universe-vision.md
 * Section A.4 — health/life both went to /me/reality, finance went to
 * /me/opportunities).
 *
 * This calls the REAL, compiled `buildUniverseZones()` from
 * shared/dist/personal/index.js (built via `tsc -p shared/tsconfig.json`)
 * with a minimal synthetic input and asserts the actual href wiring, not a
 * hand-written claim about it.
 *
 * Run from repo root: node scripts/phaseaf5-domain-rooms-smoke.mjs
 * (shared/dist must be current — run `tsc -p shared/tsconfig.json` first
 * if shared/src/personal/index.ts changed since the last build.)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let personal;
try {
  personal = require('../shared/dist/personal/index.js');
} catch (e) {
  console.error('Could not load shared/dist/personal/index.js — run `cd shared && node_modules/.bin/tsc -p tsconfig.json` first.');
  console.error(e.message);
  process.exit(1);
}
const { buildUniverseZones } = personal;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AF.5 — Command Universe dedicated domain rooms smoke\n');

const emptyInput = {
  graph: { profile: null, projects: [], assets: [], systems: [], risks: [], opportunities: [], incomeStreams: [], goals: [], pendingApprovals: 0, activeConsents: [] },
  healthStates: [], lifeItems: [], financeItems: [], learningTracks: [], nextActions: [], latestBriefing: null,
  kernel: { services: 0, openIncidents: 0, pendingApprovals: 0, safeMode: false, activeOperation: null, activeRuntimeGoal: null, recentEvents: [] },
  connectors: [],
};

const zones = buildUniverseZones(emptyInput);

console.log('— Every zone gets its own dedicated room, no shared/mismatched hrefs —');
const EXPECTED_ZONE_IDS = ['health', 'daily', 'life', 'finance', 'ventures', 'growth', 'opportunities', 'systems', 'presence'];
check('buildUniverseZones returns exactly 9 zones', zones.length === 9, `got ${zones.length}`);
for (const id of EXPECTED_ZONE_IDS) {
  const z = zones.find((x) => x.zoneId === id);
  check(`zone "${id}" exists`, Boolean(z));
  if (z) check(`zone "${id}" href is its own dedicated room (/${id})`, z.href === `/${id}`, `got ${z.href}`);
}

console.log('\n— No two zones share the same href (the exact original bug: health and life both went to /me/reality) —');
const hrefs = zones.map((z) => z.href);
const uniqueHrefs = new Set(hrefs);
check('All 9 hrefs are unique', uniqueHrefs.size === hrefs.length, `${uniqueHrefs.size} unique of ${hrefs.length}`);

console.log('\n— No zone still points at a generic catch-all page —');
const GENERIC_PAGES = ['/me/reality', '/me/opportunities', '/me/projects', '/me/resume', '/me', '/operations', '/settings/connectors'];
for (const z of zones) {
  check(`zone "${z.zoneId}" no longer points at a pre-AF.5 generic page`, !GENERIC_PAGES.includes(z.href), `href is ${z.href}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
