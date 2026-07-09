#!/usr/bin/env node
/**
 * Phase AG.3 smoke — research synthesis quality + stale last-operation fix.
 *
 * Closes the exact gap reported after AG.2: Tavily search was reachable and
 * returning real results (sourceMode: search_api), but the LLM synthesis
 * step was silently falling back to raw title/snippet restatement with no
 * explanation, and the Jarvis shell kept showing a stale failed operation
 * ahead of a newer completed one. This tests the REAL, compiled code:
 *   - LlmRouter.generateStructured()'s error-capture (shared/dist/llm/index.js)
 *   - runResearch()'s synthesisMode/synthesisFailureReason wiring (shared/dist/intelligence/index.js)
 *   - interpretResearchTaskResponse()'s synthesis surfacing (shared/dist/research/index.js)
 *   - sortRecentSessions()'s deterministic recency ordering (shared/dist/operator/index.js)
 *
 * Run from repo root (shared/dist must be current — `cd shared && node_modules/.bin/tsc -p tsconfig.json`):
 *   node scripts/phaseag3-research-synthesis-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let intelligence, research, operator, llm;
try {
  intelligence = require('../shared/dist/intelligence/index.js');
  research = require('../shared/dist/research/index.js');
  operator = require('../shared/dist/operator/index.js');
  llm = require('../shared/dist/llm/index.js');
} catch (e) {
  console.error('Could not load shared/dist/{intelligence,research,operator,llm}/index.js — run `cd shared && node_modules/.bin/tsc -p tsconfig.json` first.');
  console.error(e.message);
  process.exit(1);
}
const { runResearch } = intelligence;
const { interpretResearchTaskResponse } = research;
const { sortRecentSessions } = operator;
const { LlmRouter } = llm;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG.3 — research synthesis quality + stale last-operation smoke\n');

/* ============== 1. Tavily results + LLM available -> synthesized ============== */
console.log('— runResearch: real search results + working LLM -> llm_synthesized —');
const realResults = [
  { title: 'Dubai Luxury Lighting Trend A', url: 'https://real-a.example/1', publisher: 'real-a.example', publishedAt: '2026-06-01', snippet: 'Kinetic, AI-tunable fixtures are trending in Dubai luxury interiors.' },
  { title: 'Dubai Luxury Lighting Trend B', url: 'https://real-b.example/2', publisher: 'real-b.example', publishedAt: '2026-06-10', snippet: 'Human-centric circadian lighting is now a differentiator.' },
];
const workingRouter = {
  // Phase AG.5 — findings/opportunities are structured objects now (see
  // shared/src/intelligence/index.ts LlmFindingSchema/LlmOpportunitySchema).
  generateStructured: async (_schema, opts) => ({
    data: {
      summary: 'AI-tunable, circadian-aware lighting is redefining Dubai luxury interiors.',
      findings: [
        { title: 'AI-tunable kinetic fixtures', detail: 'Emerging as a signature feature in high-end installs.', whyItMatters: 'Differentiator: 24/6 mechanical fixtures create a moving, adaptive light experience.', confidence: 'medium', sourceIndexes: [0] },
        { title: 'Circadian/human-centric lighting', detail: 'Now a premium differentiator in luxury interiors.', whyItMatters: 'Buyers increasingly expect wellness-oriented environments.', confidence: 'medium', sourceIndexes: [1] },
      ],
      opportunities: [
        { title: 'Explore AI-tunable fixture lines', action: 'Add AI-tunable kinetic fixtures to the product line.', rationale: 'Matches an emerging signature-feature trend.', sourceIndexes: [0] },
        { title: 'Position circadian lighting as a premium upsell', action: 'Offer circadian lighting as a premium add-on.', rationale: 'Wellness positioning commands a price premium.', sourceIndexes: [1] },
      ],
      nextActions: [],
      limitations: [],
      sources: realResults.map((r) => ({ title: r.title, url: r.url, publisher: r.publisher, publishedAt: r.publishedAt, reliability: 'medium', excerpt: r.snippet })),
    },
    trace: { traceId: 't1', usedFallback: false, provider: 'openai', errorDetail: null },
  }),
};
const synthOk = await runResearch('AI lighting design trends in Dubai luxury interiors', { router: workingRouter, taskId: null, searchProvider: { providerId: 'tavily', search: async () => realResults } });
check('synthesisMode is llm_synthesized', synthOk.report.synthesisMode === 'llm_synthesized', synthOk.report.synthesisMode);
check('run.synthesisMode matches report.synthesisMode', synthOk.run.synthesisMode === synthOk.report.synthesisMode);
check('synthesisFailureReason is null on success', synthOk.report.synthesisFailureReason === null);
check('sourceMode is still search_api', synthOk.report.sourceMode === 'search_api');
check('summary is the real synthesized prose, not a generic fallback phrase', !synthOk.report.summary.includes('No LLM synthesis was performed'), synthOk.report.summary);
check('findings reflect actual synthesis, not raw title/snippet restatement', synthOk.report.findings.some((f) => f.includes('differentiator')));

/* ============ 2. Tavily results + LLM unavailable -> deterministic_fallback with explicit reason ============ */
console.log('\n— runResearch: real search results + LLM unavailable -> deterministic_fallback, explicit reason —');
const noProviderRouter = {
  generateStructured: async (_schema, opts) => ({ data: opts.fallback(), trace: { traceId: 't2', usedFallback: true, provider: 'mock', errorDetail: null } }),
};
const fallbackNoProvider = await runResearch('AI lighting design trends in Dubai luxury interiors', { router: noProviderRouter, taskId: null, searchProvider: { providerId: 'tavily', search: async () => realResults } });
check('synthesisMode is deterministic_fallback', fallbackNoProvider.report.synthesisMode === 'deterministic_fallback');
check('synthesisFailureReason explicitly says no provider is configured', /No LLM provider is configured/.test(fallbackNoProvider.report.synthesisFailureReason ?? ''), fallbackNoProvider.report.synthesisFailureReason);
check('summary states the real reason inline, not a bare "(deterministic fallback)" tag', fallbackNoProvider.report.summary.includes('did NOT run this call'), fallbackNoProvider.report.summary);
check('sourceMode is still search_api (real URLs) despite failed synthesis', fallbackNoProvider.report.sourceMode === 'search_api');

const erroringRouter = {
  generateStructured: async (_schema, opts) => ({ data: opts.fallback(), trace: { traceId: 't3', usedFallback: true, provider: 'openai', errorDetail: 'openai call failed (attempt 2): 429 rate limited' } }),
};
const fallbackWithRealError = await runResearch('AI lighting design trends in Dubai luxury interiors', { router: erroringRouter, taskId: null, searchProvider: { providerId: 'tavily', search: async () => realResults } });
check('synthesisFailureReason surfaces the REAL provider error, not a generic message', fallbackWithRealError.report.synthesisFailureReason === 'openai call failed (attempt 2): 429 rate limited', fallbackWithRealError.report.synthesisFailureReason);
check('summary embeds the real provider error', fallbackWithRealError.report.summary.includes('429 rate limited'));

/* ==================== 3. LLM hallucinated URL cannot enter sources ==================== */
console.log('\n— runResearch: hallucinated LLM URL structurally cannot enter sources (still true post-AG.3) —');
const hallucinatingRouter = {
  generateStructured: async (_schema, opts) => ({
    data: {
      summary: 'synth',
      findings: [{ title: 'f1', detail: 'd1', whyItMatters: 'w1', confidence: 'low', sourceIndexes: [] }],
      opportunities: [], nextActions: [], limitations: [],
      sources: [{ title: 'fake', url: 'https://hallucinated.example/nope', publisher: 'x', publishedAt: '', reliability: 'high', excerpt: '' }],
    },
    trace: { traceId: 't4', usedFallback: false, provider: 'openai', errorDetail: null },
  }),
};
const hallucinationTest = await runResearch('topic', { router: hallucinatingRouter, taskId: null, searchProvider: { providerId: 'tavily', search: async () => realResults } });
check('sources are rebuilt from real search results only', hallucinationTest.sources.every((s) => realResults.some((r) => r.url === s.url)));
check('hallucinated URL never appears', !hallucinationTest.sources.some((s) => s.url.includes('hallucinated')));
check('synthesisMode still correctly llm_synthesized (URL integrity is orthogonal to synthesis quality)', hallucinationTest.report.synthesisMode === 'llm_synthesized');

/* ============== 4/5. sourceMode + synthesisMode both preserved through the full chain ============== */
console.log('\n— interpretResearchTaskResponse: synthesis state surfaced to the Jarvis/operator caller —');
const okBody = {
  data: {
    research: {
      reportId: 'r1', mode: 'real', sourceMode: 'search_api', synthesisMode: 'llm_synthesized', synthesisFailureReason: null,
      summary: 'A real synthesized answer about Dubai lighting trends.',
      findings: ['finding A', 'finding B'], recommendations: ['do X'],
      sources: [{ title: 'Real', url: 'https://real.example/1', reliability: 'medium', sourceMode: 'search_api' }],
    },
  },
};
const okOutcome = interpretResearchTaskResponse(200, true, okBody);
check('ok:true, errorKind null for search_api + llm_synthesized', okOutcome.ok === true && okOutcome.errorKind === null);
check('summary embeds sourceMode tag', okOutcome.summary.includes('sourceMode: search_api'));
check('summary embeds synthesisMode tag', okOutcome.summary.includes('synthesisMode: llm_synthesized'));
check('data carries synthesisMode through', okOutcome.data.synthesisMode === 'llm_synthesized');

const fallbackBody = {
  data: {
    research: {
      reportId: 'r2', mode: 'fallback', sourceMode: 'search_api', synthesisMode: 'deterministic_fallback', synthesisFailureReason: 'No LLM provider is configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY) — this run used retrieval-only deterministic output, not LLM synthesis.',
      summary: 'Retrieved 2 real web results. LLM synthesis did NOT run this call.',
      findings: ['Title: snippet'], recommendations: [],
      sources: [{ title: 'Real', url: 'https://real.example/1', reliability: 'medium', sourceMode: 'search_api' }],
    },
  },
};
const fallbackOutcome = interpretResearchTaskResponse(200, true, fallbackBody);
check('real sources + failed synthesis is never reported as errorKind (still ok:true — honest degrade, not a service failure)', fallbackOutcome.ok === true && fallbackOutcome.errorKind === null);
check('summary embeds the real synthesis failure reason, not just a generic tag', fallbackOutcome.summary.includes('No LLM provider is configured'));
check('data.synthesisFailureReason passed through', fallbackOutcome.data.synthesisFailureReason.includes('No LLM provider is configured'));

// Backward compatibility: older payloads without synthesisMode must not crash.
const legacyBody = { data: { research: { reportId: 'r3', mode: 'real', sourceMode: 'search_api', summary: 's', findings: [], recommendations: [], sources: [] } } };
const legacyOutcome = interpretResearchTaskResponse(200, true, legacyBody);
check('legacy payload without synthesisMode defaults safely instead of crashing', legacyOutcome.ok === true && legacyOutcome.data.synthesisMode === 'deterministic_fallback');

/* ==================== 6. Jarvis/operator surfaces synthesized findings ==================== */
console.log('\n— Jarvis-facing summary includes synthesized findings when available —');
check('okOutcome summary includes at least one real finding', okOutcome.summary.includes('finding A'));

/* ========= 7/8. sortRecentSessions: newest wins, completed replaces stale failed ========= */
console.log('\n— sortRecentSessions: deterministic recency ordering —');
const sOld = { runtimeSessionId: 's_old_failed', status: 'failed', startedAt: '2026-07-09T10:00:00.000Z', completedAt: '2026-07-09T10:01:00.000Z' };
const sNew = { runtimeSessionId: 's_new_completed', status: 'completed', startedAt: '2026-07-09T11:00:00.000Z', completedAt: '2026-07-09T11:05:00.000Z' };
const ordered1 = sortRecentSessions([sOld, sNew]);
check('newest completed session sorts first regardless of input order', ordered1[0].runtimeSessionId === 's_new_completed');
const ordered2 = sortRecentSessions([sNew, sOld]);
check('order is stable/correct even when already-sorted input is given', ordered2[0].runtimeSessionId === 's_new_completed');

// The exact historical bug: an early-break failure path left completedAt null.
const sNullCompletedAtOld = { runtimeSessionId: 's_null_old', status: 'failed', startedAt: '2026-07-09T09:00:00.000Z', completedAt: null };
const sRealNew = { runtimeSessionId: 's_real_new', status: 'completed', startedAt: '2026-07-09T12:00:00.000Z', completedAt: '2026-07-09T12:02:00.000Z' };
const ordered3 = sortRecentSessions([sNullCompletedAtOld, sRealNew]);
check('a session with null completedAt (the historical bug) never outranks a real newer completed session', ordered3[0].runtimeSessionId === 's_real_new');

// Two sessions that both have null completedAt (still-active-looking in the terminal list, edge case) fall back to startedAt.
const sNullA = { runtimeSessionId: 's_null_a', status: 'failed', startedAt: '2026-07-09T08:00:00.000Z', completedAt: null };
const sNullB = { runtimeSessionId: 's_null_b', status: 'failed', startedAt: '2026-07-09T09:00:00.000Z', completedAt: null };
const ordered4 = sortRecentSessions([sNullA, sNullB]);
check('when both completedAt are null, falls back to startedAt (newer first)', ordered4[0].runtimeSessionId === 's_null_b');

// Exact tie on effective time: a session with a real completedAt outranks one without.
const sTieReal = { runtimeSessionId: 's_tie_real', status: 'completed', startedAt: '2026-07-09T13:00:00.000Z', completedAt: '2026-07-09T13:00:00.000Z' };
const sTieNull = { runtimeSessionId: 's_tie_null', status: 'failed', startedAt: '2026-07-09T13:00:00.000Z', completedAt: null };
const ordered5 = sortRecentSessions([sTieNull, sTieReal]);
check('on an exact effective-time tie, the session with a real completedAt wins', ordered5[0].runtimeSessionId === 's_tie_real');

/* ============ LlmRouter.generateStructured: real error capture (not the bare catch{}) ============ */
console.log('\n— LlmRouter.generateStructured: captures the real failure reason instead of discarding it —');
const router = new LlmRouter({ anthropicApiKey: 'fake-key-for-offline-test', defaultProvider: 'anthropic' });
// Swap in a fake provider (plain instance field, not a real #private field in
// the compiled output) so this test never makes a network call.
router.provider = { name: 'anthropic', complete: async () => { throw new Error('503 service unavailable'); } };
const { z } = require('../shared/node_modules/zod/index.cjs');
const schema = z.object({ ok: z.boolean() });
const result = await router.generateStructured(schema, {
  agentId: 'test', taskType: 'test', prompt: 'x', maxAttempts: 1,
  fallback: () => ({ ok: false }),
});
check('usedFallback is true when the provider throws', result.trace.usedFallback === true);
check('errorDetail captures the REAL thrown error, not null/generic', result.trace.errorDetail?.includes('503 service unavailable'), result.trace.errorDetail);

router.provider = { name: 'anthropic', complete: async () => ({ text: 'not valid json at all', model: 'x', provider: 'anthropic', tokensIn: 1, tokensOut: 1, costUsd: 0 }) };
const result2 = await router.generateStructured(schema, {
  agentId: 'test', taskType: 'test', prompt: 'x', maxAttempts: 1,
  fallback: () => ({ ok: false }),
});
check('errorDetail distinguishes a schema-validation failure from a thrown error', result2.trace.errorDetail?.includes('did not match the expected schema'), result2.trace.errorDetail);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
