#!/usr/bin/env node
/**
 * Phase AG smoke — Real Research & Intelligence Fabric.
 *
 * Verifies the exact gap this phase closes: `internet-research-service`
 * previously had no real web-search API, so even "real" (LLM-mode) research
 * cited source URLs the model recalled from training data, never
 * independently verified to exist. This tests the REAL, compiled
 * `runResearch()` (shared/dist/intelligence/index.js) and
 * `estimateReliability()`/`webSearchProviderFromEnv()`
 * (shared/dist/research/index.js) against fake-but-realistic router/provider
 * objects — not a hand-written claim about the behavior.
 *
 * Run from repo root (shared/dist must be current — `tsc -p shared/tsconfig.json`):
 *   node scripts/phaseag-research-fabric-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let intelligence, research;
try {
  intelligence = require('../shared/dist/intelligence/index.js');
  research = require('../shared/dist/research/index.js');
} catch (e) {
  console.error('Could not load shared/dist/{intelligence,research}/index.js — run `cd shared && node_modules/.bin/tsc -p tsconfig.json` first.');
  console.error(e.message);
  process.exit(1);
}
const { runResearch } = intelligence;
const { estimateReliability, webSearchProviderFromEnv, webSearchStatusFromEnv, TavilyProvider } = research;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG — Real Research & Intelligence Fabric smoke\n');

console.log('— estimateReliability: a heuristic, conservative by default —');
check('.gov domain is high', estimateReliability('https://nist.gov/foo') === 'high');
check('owasp.org is high', estimateReliability('https://owasp.org/www-project') === 'high');
check('reddit.com is low', estimateReliability('https://reddit.com/r/foo') === 'low');
check('unknown domain defaults to medium, never high', estimateReliability('https://some-random-blog-xyz123.example') === 'medium');
check('invalid URL is low, not a thrown error', estimateReliability('not a url') === 'low');

console.log('\n— webSearchProviderFromEnv: null (not a fake success) when unconfigured —');
check('No TAVILY_API_KEY -> null provider', webSearchProviderFromEnv({}) === null);
check('Empty-string TAVILY_API_KEY -> null provider', webSearchProviderFromEnv({ TAVILY_API_KEY: '   ' }) === null);
const provider = webSearchProviderFromEnv({ TAVILY_API_KEY: 'test-key-123' });
check('Real TAVILY_API_KEY -> a TavilyProvider instance', provider instanceof TavilyProvider);
check('webSearchStatusFromEnv reports not_configured honestly', webSearchStatusFromEnv({}).configured === false && webSearchStatusFromEnv({}).provider === 'none');
check('webSearchStatusFromEnv reports configured when key present', webSearchStatusFromEnv({ TAVILY_API_KEY: 'x' }).configured === true);

console.log('\n— runResearch: source integrity when a real search provider is configured —');
const fakeSearchResults = [
  { title: 'Real Result One', url: 'https://real-source-one.example/a', publisher: 'real-source-one.example', publishedAt: '2026-01-01', snippet: 'Genuine retrieved content one.' },
  { title: 'Real Result Two', url: 'https://real-source-two.example/b', publisher: 'real-source-two.example', publishedAt: '2026-02-01', snippet: 'Genuine retrieved content two.' },
];
// This fake router deliberately echoes DIFFERENT (subtly mutated) URLs in its
// `sources` field, simulating an LLM that mistypes or hallucinates while
// "echoing back" what it was given — the exact failure mode runResearch()
// must be structurally immune to when grounded.
const fakeRouterReal = {
  generateStructured: async (_schema, opts) => ({
    data: {
      summary: 'A synthesized summary from the real results.',
      // Phase AG.5 — findings/opportunities are structured objects now (see
      // shared/src/intelligence/index.ts LlmFindingSchema/LlmOpportunitySchema).
      findings: [
        { title: 'finding one', detail: 'detail one', whyItMatters: 'it matters one', confidence: 'medium', sourceIndexes: [0] },
        { title: 'finding two', detail: 'detail two', whyItMatters: 'it matters two', confidence: 'medium', sourceIndexes: [1] },
      ],
      opportunities: [{ title: 'do the thing', action: 'do the thing', rationale: 'because', sourceIndexes: [] }],
      nextActions: [],
      limitations: [],
      sources: [{ title: 'WRONG TITLE', url: 'https://hallucinated-url.example/wrong', publisher: 'wrong', publishedAt: '', reliability: 'high', excerpt: 'wrong' }],
    },
    trace: { traceId: 'trace_1', usedFallback: false, provider: 'openai', errorDetail: null },
  }),
};
const fakeSearchProvider = { providerId: 'tavily', search: async () => fakeSearchResults };

const grounded = await runResearch('test topic', { router: fakeRouterReal, taskId: null, searchProvider: fakeSearchProvider });
check('sourceMode is "search_api" when grounded', grounded.run.sourceMode === 'search_api', grounded.run.sourceMode);
check('report.sourceMode matches run.sourceMode', grounded.report.sourceMode === 'search_api');
check('Exactly 2 sources, matching the real search result count (not the LLM echo count of 1)', grounded.sources.length === 2, `got ${grounded.sources.length}`);
check('Source URLs are the REAL search result URLs, not the LLM-hallucinated one', grounded.sources.every((s) => fakeSearchResults.some((r) => r.url === s.url)), JSON.stringify(grounded.sources.map((s) => s.url)));
check('The hallucinated URL never appears anywhere in the output', !grounded.sources.some((s) => s.url.includes('hallucinated')));
check('Each source is tagged sourceMode: search_api', grounded.sources.every((s) => s.sourceMode === 'search_api'));

console.log('\n— runResearch: honest sourceMode when no search provider is configured —');
const ungroundedReal = await runResearch('test topic', { router: fakeRouterReal, taskId: null, searchProvider: null });
check('sourceMode is "llm_only" (real LLM, no search, URLs are recalled not verified)', ungroundedReal.run.sourceMode === 'llm_only', ungroundedReal.run.sourceMode);

const fakeRouterFallback = {
  generateStructured: async (_schema, opts) => ({ data: opts.fallback(), trace: { traceId: 'trace_2', usedFallback: true } }),
};
const ungroundedFallback = await runResearch('security dashboard', { router: fakeRouterFallback, taskId: null, searchProvider: null });
check('sourceMode is "curated_fallback" (no search, no real LLM)', ungroundedFallback.run.sourceMode === 'curated_fallback', ungroundedFallback.run.sourceMode);

console.log('\n— runResearch: search provider configured but search itself fails —');
const failingSearchProvider = { providerId: 'tavily', search: async () => { throw new Error('rate limited'); } };
const searchFailed = await runResearch('test topic', { router: fakeRouterReal, taskId: null, searchProvider: failingSearchProvider });
check('Falls back to non-grounded sourceMode, never crashes', searchFailed.run.sourceMode === 'llm_only', searchFailed.run.sourceMode);
check('Summary honestly notes the search failure, not silently hidden', searchFailed.report.summary.includes('web search unavailable'), searchFailed.report.summary);

console.log('\n— runResearch: search configured, LLM unavailable — still uses REAL results, not canned fallback —');
const fallbackButGrounded = await runResearch('test topic', { router: fakeRouterFallback, taskId: null, searchProvider: fakeSearchProvider });
check('sourceMode is still "search_api" even though the LLM fell back', fallbackButGrounded.run.sourceMode === 'search_api', fallbackButGrounded.run.sourceMode);
check('Sources are still the real search results, not the curated-fallback canned URL', fallbackButGrounded.sources.every((s) => fakeSearchResults.some((r) => r.url === s.url)));
check('Findings are built from real snippets, not the generic curated text', fallbackButGrounded.report.findings.some((f) => f.includes('Genuine retrieved content')), JSON.stringify(fallbackButGrounded.report.findings));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
