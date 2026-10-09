#!/usr/bin/env node
/**
 * Phase AG.4 smoke — research route/host contract fix.
 *
 * Closes the exact gap reported after AG.3: research was reachable (Phase
 * AG.2) but gateway-api's dispatchResearch() got "internet-research-service
 * returned 404: unknown error". Root cause: every service's manifest
 * hardcodes its PRODUCTION subdomain (`domain: https://{id}.simorx.com` —
 * see manifest.ts), and once internet-research-service actually started
 * locally and self-registered with a reachable local service-registry
 * (true only since Phase AG.2), gateway-api's `svc?.domain ?? peerUrl(...)`
 * silently preferred that production domain over the correct localhost URL
 * — reachable (some host answered), but not this service, hence 404. This
 * tests the REAL, compiled fix: `resolvePeerUrl()` (shared/dist/discovery/
 * index.js), the improved `interpretResearchTaskResponse()` 404 handling
 * (shared/dist/research/index.js), and the local-dev env override wiring
 * (scripts/local-services.mjs).
 *
 * Run from repo root (shared/dist must be current — `cd shared && node_modules/.bin/tsc -p tsconfig.json`):
 *   node scripts/phaseag4-research-route-contract-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let discovery, research, constants;
try {
  discovery = require('../shared/dist/discovery/index.js');
  research = require('../shared/dist/research/index.js');
  constants = require('../shared/dist/constants/index.js');
} catch (e) {
  console.error('Could not load shared/dist/{discovery,research,constants}/index.js — run `cd shared && node_modules/.bin/tsc -p tsconfig.json` first.');
  console.error(e.message);
  process.exit(1);
}
const { resolvePeerUrl } = discovery;
const { interpretResearchTaskResponse } = research;
const { FACTORY_ENDPOINTS, SERVICE_IDS } = constants;
const { LOCAL_SERVICES } = require('./local-services.mjs');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG.4 — research route/host contract smoke\n');

console.log('— The actual bug: manifest.domain is a real production subdomain, not a placeholder —');
check('research, review, QA, report, and documentation are not production service ids', !['documentation-service', 'internet-research-service', 'report-agent', 'qa-agent', 'reviewer-agent'].some((id) => Object.values(SERVICE_IDS).includes(id)));
check('FACTORY_ENDPOINTS.TASK is /.factory/task', FACTORY_ENDPOINTS.TASK === '/.factory/task');

console.log('\n— resolvePeerUrl(): override still beats a registry domain for a live service —');
const registryDomain = 'https://orchestrator.simorx.com';
check('With NO env override: registry domain is used', resolvePeerUrl('orchestrator-agent', registryDomain, {}) === registryDomain, resolvePeerUrl('orchestrator-agent', registryDomain, {}));
check('With the local env override set: it wins over the registry domain', resolvePeerUrl('orchestrator-agent', registryDomain, { ORCHESTRATOR_AGENT_URL: 'http://localhost:4102' }) === 'http://localhost:4102');
check('With NO registry domain AND no override: falls back to peerUrl() localhost default', resolvePeerUrl('orchestrator-agent', null, {}) === 'http://localhost:4102');
check('With NO registry domain but WITH an override: override still wins', resolvePeerUrl('orchestrator-agent', undefined, { ORCHESTRATOR_AGENT_URL: 'http://localhost:9999' }) === 'http://localhost:9999');
check('Trailing slashes are stripped consistently from both override and registry domain', resolvePeerUrl('orchestrator-agent', 'https://orchestrator.simorx.com/', {}) === 'https://orchestrator.simorx.com' && resolvePeerUrl('x', null, { X_URL: 'http://localhost:1/' }) === 'http://localhost:1');

console.log('\n— scripts/local-services.mjs: the local override is actually wired for gateway-api —');
const gw = LOCAL_SERVICES.find((s) => s.id === 'gateway-api');
check('gateway-api entry exists', Boolean(gw));
check('gateway-api extra does not point research at a removed service', !/INTERNET_RESEARCH_SERVICE_URL/.test(gw?.extra ?? ''), gw?.extra);
check('gateway-api extra still retains ORCHESTRATOR_AGENT_URL', /ORCHESTRATOR_AGENT_URL=http:\/\/localhost:4102/.test(gw?.extra ?? ''));

console.log('\n— interpretResearchTaskResponse(): 404 is now diagnosable, not "unknown error" —');
const notFound = interpretResearchTaskResponse(404, false, {}, { url: 'https://research.simorx.com/.factory/task', method: 'POST' });
check('404 -> errorKind route_not_found, not the generic service_error bucket', notFound.errorKind === 'route_not_found', notFound.errorKind);
check('ok:false on a 404', notFound.ok === false);
check('Summary embeds the exact URL and method that were called', notFound.summary.includes('https://research.simorx.com/.factory/task') && notFound.summary.includes('POST'), notFound.summary);
check('Summary gives a concrete diagnostic hint, not just a bare status code', /resolving internet-research-service|correct local URL/.test(notFound.summary), notFound.summary);

const notFoundWithHtmlBody = interpretResearchTaskResponse(404, false, {}, { url: 'https://research.simorx.com/.factory/task', method: 'POST', rawBodySnippet: '<html><body>404 Not Found</body></html>' });
check('A non-JSON (HTML) 404 body is surfaced in the summary instead of silently becoming "unknown error"', notFoundWithHtmlBody.summary.includes('404 Not Found'), notFoundWithHtmlBody.summary);
check('Never says the bare, undiagnosable "unknown error" when a raw body was captured', !notFoundWithHtmlBody.summary.includes('unknown error'));

const notFoundNoBody = interpretResearchTaskResponse(404, false, {});
check('With genuinely no context at all (legacy 3-arg call), still classifies as route_not_found and does not crash', notFoundNoBody.errorKind === 'route_not_found' && notFoundNoBody.ok === false);

const method405 = interpretResearchTaskResponse(405, false, {}, { url: 'http://localhost:4115/.factory/task', method: 'GET' });
check('405 Method Not Allowed is also classified as route_not_found (method/path mismatch)', method405.errorKind === 'route_not_found');

console.log('\n— Regression: existing HTTP-error / success paths are unchanged by the new 4th param —');
const serverErr = interpretResearchTaskResponse(500, false, { error: { message: 'internal error' } });
check('500 is still service_error, NOT route_not_found (only 404/405 are route contract issues)', serverErr.errorKind === 'service_error');
const fakeResearch = (sourceMode, mode = 'real') => ({
  data: { research: { reportId: 'rr_1', mode, sourceMode, synthesisMode: 'llm_synthesized', synthesisFailureReason: null, summary: 'summary text', findings: ['f1'], recommendations: ['r1'], sources: [{ title: 'Real Source', url: 'https://real.example/a', reliability: 'medium', sourceMode }] } },
});
const success = interpretResearchTaskResponse(200, true, fakeResearch('search_api'));
check('200 + search_api still resolves ok:true, errorKind null (the success case, unaffected by the fix)', success.ok === true && success.errorKind === null);
check('sourceMode still survives to the Jarvis-facing summary', success.summary.includes('sourceMode: search_api'));
check('synthesisMode still survives to the Jarvis-facing summary', success.summary.includes('synthesisMode: llm_synthesized'));
check('data.synthesisMode still passed through', success.data.synthesisMode === 'llm_synthesized');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
