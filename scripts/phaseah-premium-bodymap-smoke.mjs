#!/usr/bin/env node
/**
 * Phase AH.2 smoke — Health Intelligence Surface (supersedes the Phase AH
 * checks; the surface was rebuilt the same day from a single-figure body map
 * into a layered health intelligence module).
 *
 * Verifies:
 *  1. The old stick-figure primitives stay gone; the refined anatomy
 *     (skull/jaw, clavicles, ribcage, spine, pelvis, joint nodes) exists.
 *  2. The domain registry: 14 anatomical regions + 6 systemic layers, all
 *     represented in the scan (regions) or layer strip (layers).
 *  3. Metric → domain mapping incl. keyword fallback and unknown → general.
 *  4. Graded severity (critical/attention/moderate/optimal/noted) and
 *     distinct concern visuals (bm-pulse + counters).
 *  5. Model behavior with zero / one / many metrics (same-domain stacking,
 *     worst level, derived averages — nothing invented).
 *  6. Both surfaces render the same component; /health uses variant="full".
 *  7. Hydration safety: nothing random or time-derived, static ids.
 *
 * lib/bodyZones.ts is JSX-free by design so it compiles standalone:
 *   cd services/dashboard-web && node_modules/.bin/tsc --module commonjs \
 *     --target es2020 --outDir /tmp/aos-ah2-check --skipLibCheck \
 *     src/lib/bodyZones.ts
 * Then run from repo root: node scripts/phaseah-premium-bodymap-smoke.mjs
 * (This script attempts that compile itself if the output is missing.)
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'services', 'dashboard-web');

if (!existsSync('/tmp/aos-ah2-check/bodyZones.js')) {
  try {
    execSync('node_modules/.bin/tsc --module commonjs --target es2020 --outDir /tmp/aos-ah2-check --skipLibCheck src/lib/bodyZones.ts', { cwd: web, stdio: 'inherit' });
  } catch {
    console.error('Could not compile src/lib/bodyZones.ts — run the compile step in this file\'s header first.');
    process.exit(1);
  }
}

let hz;
try {
  hz = require('/tmp/aos-ah2-check/bodyZones.js');
} catch (e) {
  console.error('Could not load compiled bodyZones module.');
  console.error(e.message);
  process.exit(1);
}
const {
  REGION_IDS, LAYER_IDS, DOMAIN_LABELS, domainForMetric, buildHealthModel,
  metricSeverity, domainChipText, isRegion,
} = hz;

const scanSrc = readFileSync(join(web, 'src', 'components', 'health', 'BodyScan.tsx'), 'utf8');
const surfaceSrc = readFileSync(join(web, 'src', 'components', 'health', 'HealthIntelligence.tsx'), 'utf8');
const wrapperSrc = readFileSync(join(web, 'src', 'components', 'BodyMap.tsx'), 'utf8');
const healthPageSrc = readFileSync(join(web, 'src', 'app', 'health', 'page.tsx'), 'utf8');
const homeLiveSrc = readFileSync(join(web, 'src', 'components', 'HomeLive.tsx'), 'utf8');
const allComponentSrc = scanSrc + surfaceSrc + wrapperSrc;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AH.2 — Health Intelligence Surface smoke\n');

console.log('— 1. Old stickman gone, refined anatomy present —');
check('no stick-figure spine stroke (M60 39 L60 110)', !allComponentSrc.includes('M60 39 L60 110'));
check('no old floating NODE_POS constellation', !allComponentSrc.includes('NODE_POS'));
check('anatomical silhouette path present', scanSrc.includes('SILHOUETTE_D') && scanSrc.includes('M 112 54'));
check('skull/jaw head (not a plain ellipse)', scanSrc.includes('SKULL_D') && !scanSrc.includes('<ellipse cx="120" cy="36"'));
check('skeletal segmentation: clavicles + sternum + ribs + pelvis + joints',
  scanSrc.includes('clavicles, sternum, ribcage, spine, pelvis') && scanSrc.includes('joint nodes'));

console.log('\n— 2. Domain registry: regions + systemic layers —');
check('14 anatomical regions', REGION_IDS.length === 14, JSON.stringify(REGION_IDS));
for (const r of ['head', 'eyes', 'hair', 'ears', 'mouth', 'neck', 'chest', 'abdomen', 'gut', 'spine', 'arms', 'hips', 'legs', 'feet']) {
  check(`region "${r}" registered + labeled`, REGION_IDS.includes(r) && typeof DOMAIN_LABELS[r] === 'string');
}
check('6 systemic layers', LAYER_IDS.length === 6, JSON.stringify(LAYER_IDS));
for (const l of ['recovery', 'nervous', 'activity', 'composition', 'vitality', 'general']) {
  check(`layer "${l}" registered, not a body region`, LAYER_IDS.includes(l) && !isRegion(l));
}
check('scan renders every region as data-zone', scanSrc.includes('data-zone={id}') && scanSrc.includes('REGION_IDS.map'));
check('scan has per-region hotspots', scanSrc.includes('data-zone-hotspot'));
check('layers render as strip chips, never body dots', surfaceSrc.includes('data-layer-chip') && !scanSrc.includes('LAYER_IDS'));

console.log('\n— 3. Metric → domain mapping —');
check('heart/hrv/blood_pressure → chest', ['heart', 'hrv', 'blood_pressure'].every((m) => domainForMetric(m) === 'chest'));
check('vision → eyes, hearing → ears, dental → mouth', domainForMetric('vision') === 'eyes' && domainForMetric('hearing') === 'ears' && domainForMetric('dental') === 'mouth');
check('hair → hair, thyroid → neck', domainForMetric('hair') === 'hair' && domainForMetric('thyroid') === 'neck');
check('focus/mood/memory → head (mind)', ['focus', 'mood', 'memory'].every((m) => domainForMetric(m) === 'head'));
check('nutrition/digestion/hydration → abdomen', ['nutrition', 'digestion', 'hydration'].every((m) => domainForMetric(m) === 'abdomen'));
check('liver/kidney → gut', domainForMetric('liver') === 'gut' && domainForMetric('kidney') === 'gut');
check('posture/back → spine', domainForMetric('posture') === 'spine' && domainForMetric('back') === 'spine');
check('strength/grip/shoulder → arms', ['strength', 'grip', 'shoulder'].every((m) => domainForMetric(m) === 'arms'));
check('knee → legs, foot → feet, pelvis → hips', domainForMetric('knee') === 'legs' && domainForMetric('foot') === 'feet' && domainForMetric('pelvis') === 'hips');
check('sleep → recovery layer', domainForMetric('sleep') === 'recovery');
check('stress/anxiety → nervous layer', domainForMetric('stress') === 'nervous' && domainForMetric('anxiety') === 'nervous');
check('steps/exercise/habit → activity layer', ['steps', 'exercise', 'habit'].every((m) => domainForMetric(m) === 'activity'));
check('weight/bmi/muscle → composition layer', ['weight', 'bmi', 'muscle'].every((m) => domainForMetric(m) === 'composition'));
check('energy/hormone/wellbeing → vitality layer', ['energy', 'hormone', 'wellbeing'].every((m) => domainForMetric(m) === 'vitality'));
check('keyword fallback (sleep_quality → recovery)', domainForMetric('sleep_quality') === 'recovery');
check('unknown metric → general layer (never dropped)', domainForMetric('quantum_flux') === 'general');

console.log('\n— 4. Graded severity + distinct concern visuals —');
check('concern + low level → critical', metricSeverity({ metric: 'x', level: 2, concern: true, detail: '' }) === 'critical');
check('concern + ok level → attention', metricSeverity({ metric: 'x', level: 7, concern: true, detail: '' }) === 'attention');
check('low level w/o concern → attention', metricSeverity({ metric: 'x', level: 3, concern: false, detail: '' }) === 'attention');
check('mid level → moderate', metricSeverity({ metric: 'x', level: 5, concern: false, detail: '' }) === 'moderate');
check('high level → optimal', metricSeverity({ metric: 'x', level: 9, concern: false, detail: '' }) === 'optimal');
check('no level, no concern → noted', metricSeverity({ metric: 'x', level: null, concern: false, detail: 'n' }) === 'noted');
check('concern renders bm-pulse in scan + strip + breakdown', scanSrc.includes('bm-pulse') && surfaceSrc.includes('bm-pulse'));
const concernModel = buildHealthModel([{ metric: 'knee', level: 2, concern: true, detail: '' }]);
check('domain inherits worst severity', concernModel.domains.legs.severity === 'critical' && concernModel.concernCount === 1);

console.log('\n— 5. Zero / one / many metrics —');
const emptyModel = buildHealthModel([]);
check('zero: all 20 domains exist, none active', [...REGION_IDS, ...LAYER_IDS].every((d) => emptyModel.domains[d] && !emptyModel.domains[d].active));
check('zero: intentional standby state', surfaceSrc.includes('Awaiting biometric signals') && surfaceSrc.includes('standby'));
const oneModel = buildHealthModel([{ metric: 'energy', level: 7, concern: false, detail: '' }]);
check('one: exactly one active domain (vitality)', oneModel.activeDomains.length === 1 && oneModel.activeDomains[0].domain === 'vitality');
const manyModel = buildHealthModel([
  { metric: 'hrv', level: 3, concern: false, detail: '' },
  { metric: 'heart', level: 8, concern: false, detail: '' },
  { metric: 'sleep', level: 6, concern: false, detail: '' },
  { metric: 'weight', level: null, concern: false, detail: '82 kg' },
]);
check('many: same-domain metrics stack (hrv+heart → chest)', manyModel.domains.chest.metrics.length === 2);
check('many: worstLevel is min, severity is worst', manyModel.domains.chest.worstLevel === 3 && manyModel.domains.chest.severity === 'attention');
check('many: average derived only from real levels', manyModel.averageLevel === 5.7, String(manyModel.averageLevel));
check('many: chip shows worst first + overflow count', domainChipText(manyModel.domains.chest) === '3/10 +1', domainChipText(manyModel.domains.chest));
check('activeDomains sorted worst-first', manyModel.activeDomains[0].domain === 'chest');
check('rails cap chips + overflow indicator (scale without ugliness)', scanSrc.includes('maxChipsPerRail') && scanSrc.includes('more'));

console.log('\n— 6. Both surfaces, one system —');
check('/health renders BodyMap variant="full"', healthPageSrc.includes('<BodyMap') && healthPageSrc.includes('variant="full"'));
check('homepage health card renders BodyMap', homeLiveSrc.includes("from './BodyMap'") && homeLiveSrc.includes('<BodyMap'));
check('BodyMap delegates to HealthIntelligence (compat wrapper)', wrapperSrc.includes('HealthIntelligence'));
check('full variant adds domain breakdown', surfaceSrc.includes('data-domain-breakdown'));

console.log('\n— 7. Hydration safety —');
check('no Math.random anywhere in the surface', !allComponentSrc.includes('Math.random'));
check('no Date.now / new Date anywhere in the surface', !allComponentSrc.includes('Date.now') && !allComponentSrc.includes('new Date('));
check('static gradient/filter ids', scanSrc.includes('id="bmFill"') && scanSrc.includes('id="bmGlow"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
