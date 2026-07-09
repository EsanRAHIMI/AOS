#!/usr/bin/env node
/**
 * Phase AG.2 smoke — internet-research-service reachability.
 *
 * Phase AG.1 wired Jarvis/operator tools to call internet-research-service
 * synchronously, which immediately surfaced a pre-existing gap: the service
 * was never in `scripts/local-services.mjs` (the single source of truth for
 * both `pnpm dev:all` and `pnpm sync:env`), so in local dev nothing ever
 * listened on its port and it never got a `.env` file — every call failed
 * with a generic "fetch failed", regardless of whether TAVILY_API_KEY was
 * configured. This checks the two independent halves of the fix:
 *   1. the service catalog now includes internet-research-service (so
 *      `pnpm dev:all`/`pnpm sync:env` actually start it and give it env), and
 *   2. gateway-api's dispatch now classifies a real connection failure as
 *      `service_unreachable` (not a generic message), and separates that
 *      from a genuinely reachable-but-not-configured provider — via pure,
 *      network-free helpers in shared/src/research.
 *
 * Run from repo root after building shared:
 *   node scripts/phaseag2-research-reachability-smoke.mjs
 */
import {
  classifyResearchFetchFailure, interpretResearchTaskResponse,
} from '../shared/dist/research/index.js';
import { peerUrl, peerEnvKey } from '../shared/dist/discovery/index.js';
import { LOCAL_SERVICES } from './local-services.mjs';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG.2 — research service reachability smoke\n');

console.log('— Service catalog: internet-research-service is actually started locally —');
const entry = LOCAL_SERVICES.find((s) => s.id === 'internet-research-service');
check('Present in LOCAL_SERVICES (drives pnpm dev:all)', Boolean(entry));
check('Correct dir/pkg/port (matches shared/src/constants SERVICE_PORTS)', entry?.dir === 'internet-research-service' && entry?.pkg === '@factory/internet-research-service' && entry?.port === 4115, JSON.stringify(entry));
check('Every LOCAL_SERVICES entry has a unique port (no silent collision)', new Set(LOCAL_SERVICES.map((s) => s.port)).size === LOCAL_SERVICES.length);
check('Every LOCAL_SERVICES id is unique', new Set(LOCAL_SERVICES.map((s) => s.id)).size === LOCAL_SERVICES.length);

console.log('— Peer URL construction (gateway dispatchResearch uses this) —');
check('Default (no env override) resolves to localhost:4115', peerUrl('internet-research-service', {}) === 'http://localhost:4115');
check('Env override wins when set', peerUrl('internet-research-service', { [peerEnvKey('internet-research-service')]: 'https://research.simorx.com' }) === 'https://research.simorx.com');
check('Env override key name matches the documented convention', peerEnvKey('internet-research-service') === 'INTERNET_RESEARCH_SERVICE_URL');

console.log('— classifyResearchFetchFailure: connection failure vs other thrown errors —');
const f1 = classifyResearchFetchFailure('http://localhost:4115', 'fetch failed');
check('"fetch failed" -> service_unreachable, ok:false', f1.errorKind === 'service_unreachable' && f1.ok === false);
check('Message names the actual URL and gives a concrete next step', f1.summary.includes('http://localhost:4115') && /pnpm --filter @factory\/internet-research-service run dev/.test(f1.summary));
const f2 = classifyResearchFetchFailure('http://localhost:4115', 'connect ECONNREFUSED 127.0.0.1:4115');
check('ECONNREFUSED -> service_unreachable', f2.errorKind === 'service_unreachable');
const f3 = classifyResearchFetchFailure('http://localhost:4115', 'The operation was aborted due to timeout');
check('Timeout/AbortError -> service_unreachable', f3.errorKind === 'service_unreachable');
const f4 = classifyResearchFetchFailure('http://localhost:4115', 'Unexpected token < in JSON');
check('A non-connection error is NOT mislabeled service_unreachable', f4.errorKind !== 'service_unreachable');

console.log('— interpretResearchTaskResponse: reachable-but-different-states —');
const httpErr = interpretResearchTaskResponse(500, false, { error: { message: 'internal error' } });
check('Non-2xx HTTP -> service_error, ok:false', httpErr.errorKind === 'service_error' && httpErr.ok === false);
const empty = interpretResearchTaskResponse(200, true, { data: {} });
check('200 but no research payload -> empty_result, ok:false', empty.errorKind === 'empty_result' && empty.ok === false);
const fakeResearch = (sourceMode, mode = 'real') => ({
  data: { research: { reportId: 'rr_1', mode, sourceMode, summary: 'summary text', findings: ['f1'], recommendations: ['r1'], sources: [{ title: 'Real Source', url: 'https://real.example/a', reliability: 'medium', sourceMode }] } },
});
const notConfigured = interpretResearchTaskResponse(200, true, fakeResearch('llm_only'));
check('Reachable, sourceMode llm_only -> provider_not_configured, but ok:true (not a failure)', notConfigured.errorKind === 'provider_not_configured' && notConfigured.ok === true);
const curated = interpretResearchTaskResponse(200, true, fakeResearch('curated_fallback'));
check('Reachable, sourceMode curated_fallback -> provider_not_configured, ok:true', curated.errorKind === 'provider_not_configured' && curated.ok === true);
const real = interpretResearchTaskResponse(200, true, fakeResearch('search_api'));
check('Reachable, sourceMode search_api -> errorKind null, ok:true (the success case)', real.errorKind === null && real.ok === true);
check('Success summary embeds the real sourceMode label', real.summary.includes('sourceMode: search_api'));
check('Success summary embeds the real source URL, not a placeholder', real.summary.includes('https://real.example/a'));
check('provider_not_configured never appears when sourceMode is search_api (no false positive)', real.errorKind !== 'provider_not_configured');
check('service_unreachable is never returned for a reachable, well-formed response', ![notConfigured, curated, real].some((o) => o.errorKind === 'service_unreachable'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
