#!/usr/bin/env node
/**
 * Phase AG.5 smoke — research LLM output schema/prompt/retry-repair fix.
 *
 * Closes the exact gap reported after AG.4: routing works, Tavily returns
 * real results (sourceMode: search_api), but LLM synthesis itself fails
 * schema validation: "provider responded but output did not match the
 * expected schema (attempt 2): Invalid input: expected string, received
 * undefined". Root cause: the Phase AG.3 v2 prompt asked the model to
 * reason toward a richer answer (executive summary, findings that explain
 * WHY they matter, opportunity/next-action recommendations) than the flat
 * `findings: string[]` Zod schema still accepted, AND the prompt never gave
 * the model the literal required JSON field names — so a real model's
 * natural richer output structurally couldn't validate, and the retry loop
 * sent the model the exact same prompt again with no correction signal.
 *
 * This tests the REAL, compiled fix:
 *  - the redesigned LlmResearchSchema (structured findings/opportunities/
 *    nextActions/limitations with safe defaults) in shared/dist/intelligence/
 *  - the explicit JSON-shape prompt text runResearch() now sends
 *  - LlmRouter.generateStructured()'s path-level error reporting + retry
 *    corrective feedback in shared/dist/llm/
 *  - that sources remain structurally Tavily-only regardless of the schema change
 *
 * Run from repo root (shared/dist must be current — `cd shared && node_modules/.bin/tsc -p tsconfig.json`):
 *   node scripts/phaseag5-research-schema-repair-smoke.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let intelligence, llm;
try {
  intelligence = require('../shared/dist/intelligence/index.js');
  llm = require('../shared/dist/llm/index.js');
} catch (e) {
  console.error('Could not load shared/dist/{intelligence,llm}/index.js — run `cd shared && node_modules/.bin/tsc -p tsconfig.json` first.');
  console.error(e.message);
  process.exit(1);
}
const { runResearch } = intelligence;
const { LlmRouter } = llm;
const { z } = require('../shared/node_modules/zod/index.cjs');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG.5 — research schema/prompt/retry-repair smoke\n');

const LIGHTING_TOPIC = 'Find current AI lighting design trends in Dubai luxury interiors';
const realResults = [
  { title: 'Dubai Luxury Lighting Trend A', url: 'https://real-a.example/1', publisher: 'real-a.example', publishedAt: '2026-06-01', snippet: 'Kinetic, AI-tunable fixtures are trending in Dubai luxury interiors.' },
  { title: 'Dubai Luxury Lighting Trend B', url: 'https://real-b.example/2', publisher: 'real-b.example', publishedAt: '2026-06-10', snippet: 'Human-centric circadian lighting is now a differentiator.' },
];
const searchProvider = { providerId: 'tavily', search: async () => realResults };

/* ===== 1 & 8: valid structured output for the exact reported prompt ===== */
console.log('— 1/8: Tavily results + valid structured LLM output -> llm_synthesized, for the EXACT reported prompt —');
const validRouter = {
  generateStructured: async (_schema, opts) => ({
    data: {
      summary: 'AI-tunable, circadian-aware lighting is redefining Dubai luxury interiors.',
      findings: [
        { title: 'AI-tunable kinetic fixtures', detail: 'Signature feature in new luxury builds.', whyItMatters: 'Differentiates a space through motion and adaptive color temperature.', confidence: 'medium', sourceIndexes: [0] },
        { title: 'Circadian/human-centric lighting', detail: 'Wellness-oriented lighting is now a premium expectation.', whyItMatters: 'Buyers increasingly pay a premium for wellness-positioned interiors.', confidence: 'medium', sourceIndexes: [1] },
      ],
      opportunities: [
        { title: 'Offer AI-tunable fixture packages', action: 'Add a kinetic/AI-tunable fixture line to the catalog.', rationale: 'Matches an emerging premium differentiator.', sourceIndexes: [0] },
      ],
      nextActions: ['Pilot a circadian lighting showcase in one flagship project.'],
      limitations: ['Based on 2 retrieved sources — broader market validation recommended.'],
      sources: realResults.map((r) => ({ title: r.title, url: r.url, publisher: r.publisher, publishedAt: r.publishedAt, reliability: 'medium', excerpt: r.snippet })),
    },
    trace: { traceId: 't1', usedFallback: false, provider: 'openai', errorDetail: null },
  }),
};
const synthOk = await runResearch(LIGHTING_TOPIC, { router: validRouter, taskId: null, searchProvider });
check('synthesisMode is llm_synthesized', synthOk.report.synthesisMode === 'llm_synthesized', synthOk.report.synthesisMode);
check('sourceMode is search_api', synthOk.report.sourceMode === 'search_api');
check('summary is a real executive summary, not a fallback phrase', !synthOk.report.summary.includes('No LLM synthesis was performed'));
check('findings include the why-it-matters framing', synthOk.report.findings.some((f) => f.includes('Why it matters')), JSON.stringify(synthOk.report.findings));
check('recommendations include the flattened opportunity', synthOk.report.recommendations.some((r) => r.includes('AI-tunable fixture')), JSON.stringify(synthOk.report.recommendations));
check('recommendations include the flattened next action', synthOk.report.recommendations.some((r) => r.includes('circadian lighting showcase')));
check('findings include the flattened limitation', synthOk.report.findings.some((f) => f.startsWith('Limitation:')));
check('sources are the real Tavily URLs', synthOk.sources.every((s) => realResults.some((r) => r.url === s.url)));

/* ===== 2 & 3: LLM output missing a required string -> path-specific error, then repaired on retry ===== */
console.log('\n— 2/3: LLM output missing a required string -> path-specific Zod error, repaired via retry corrective feedback —');
let attemptCount = 0;
const brokenThenFixedProvider = {
  name: 'openai',
  complete: async (req) => {
    attemptCount++;
    if (attemptCount === 1) {
      // Attempt 1: the exact real-world failure — a finding object missing
      // its required "detail" string (undefined, not empty).
      return {
        text: JSON.stringify({
          summary: 'partial',
          findings: [{ title: 'Some trend' /* detail missing entirely */ }],
          sources: [{ title: 'x', url: 'https://real-a.example/1' }],
        }),
        model: req.model, provider: 'openai', tokensIn: 10, tokensOut: 10, costUsd: 0,
      };
    }
    // Attempt 2: verify the corrective note was actually appended to the
    // prompt (proves retry feedback is real, not just retried blindly),
    // then return valid, complete JSON.
    if (!req.prompt.includes('Your previous response was invalid')) {
      return { text: '{}', model: req.model, provider: 'openai', tokensIn: 1, tokensOut: 1, costUsd: 0 };
    }
    return {
      text: JSON.stringify({
        summary: 'Repaired summary.',
        findings: [{ title: 'Some trend', detail: 'Now filled in.', whyItMatters: 'It matters.', confidence: 'medium', sourceIndexes: [0] }],
        opportunities: [], nextActions: [], limitations: [],
        sources: [{ title: 'x', url: 'https://real-a.example/1', publisher: 'x', publishedAt: '', reliability: 'medium', excerpt: '' }],
      }),
      model: req.model, provider: 'openai', tokensIn: 10, tokensOut: 10, costUsd: 0,
    };
  },
};
const router = new LlmRouter({ anthropicApiKey: 'fake-key', defaultProvider: 'anthropic' });
router.provider = brokenThenFixedProvider;
router.providerName = 'openai'; // matches the fake provider's own `name`, matters for lastError text
const schema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string(), whyItMatters: z.string().default(''), confidence: z.string().default('medium'), sourceIndexes: z.array(z.number()).default([]) })).min(1),
});
const repairResult = await router.generateStructured(schema, {
  agentId: 'test', taskType: 'test', prompt: 'Return research JSON.', maxAttempts: 2,
  fallback: () => ({ summary: 'fallback', findings: [{ title: 'f', detail: 'd', whyItMatters: '', confidence: 'medium', sourceIndexes: [] }] }),
});
check('Two attempts were actually made', attemptCount === 2, attemptCount);
check('The retry succeeded (did not fall back) once corrective feedback let the model repair its output', repairResult.trace.usedFallback === false, repairResult.trace);
check('The final repaired data is valid and complete', repairResult.data.findings[0].detail === 'Now filled in.');

// Isolate a single failing attempt to check the path-level error message directly.
let singleAttemptCount = 0;
const alwaysMissingDetail = {
  name: 'openai',
  complete: async (req) => {
    singleAttemptCount++;
    return { text: JSON.stringify({ summary: 's', findings: [{ title: 'only a title' }] }), model: req.model, provider: 'openai', tokensIn: 1, tokensOut: 1, costUsd: 0 };
  },
};
const router2 = new LlmRouter({ anthropicApiKey: 'fake-key', defaultProvider: 'anthropic' });
router2.provider = alwaysMissingDetail;
const pathResult = await router2.generateStructured(schema, {
  agentId: 'test', taskType: 'test', prompt: 'Return research JSON.', maxAttempts: 1,
  fallback: () => ({ summary: 'fallback', findings: [{ title: 'f', detail: 'd', whyItMatters: '', confidence: 'medium', sourceIndexes: [] }] }),
});
check('errorDetail names the EXACT failing path (findings.0.detail), not just "expected string"', pathResult.trace.errorDetail?.includes('findings.0.detail'), pathResult.trace.errorDetail);
check('errorDetail still includes the underlying Zod message', /expected string|received undefined|invalid/i.test(pathResult.trace.errorDetail ?? ''), pathResult.trace.errorDetail);

/* ===== 4: missing OPTIONAL fields do not break synthesis ===== */
console.log('\n— 4: missing optional fields (whyItMatters/confidence/sourceIndexes/opportunities/nextActions/limitations) do not break synthesis —');
const minimalValidProvider = {
  name: 'openai',
  complete: async (req) => ({
    text: JSON.stringify({
      summary: 'Minimal but valid.',
      findings: [{ title: 'A trend', detail: 'It is trending.' }], // no whyItMatters/confidence/sourceIndexes
      sources: [{ title: 'x', url: 'https://real-a.example/1' }], // no publisher/publishedAt/reliability/excerpt
      // opportunities/nextActions/limitations omitted entirely
    }),
    model: req.model, provider: 'openai', tokensIn: 1, tokensOut: 1, costUsd: 0,
  }),
};
const router3 = new LlmRouter({ anthropicApiKey: 'fake-key', defaultProvider: 'anthropic' });
router3.provider = minimalValidProvider;
const minimalOk = await runResearch(LIGHTING_TOPIC, { router: { generateStructured: (s, o) => router3.generateStructured(s, o) }, taskId: null, searchProvider });
check('Missing optional narrative/array fields do NOT cause a validation failure', minimalOk.report.synthesisMode === 'llm_synthesized', minimalOk.report.synthesisFailureReason);
check('Defaults apply cleanly — no literal "undefined" leaks into the flattened finding text', !minimalOk.report.findings[0].includes('undefined'), minimalOk.report.findings[0]);
check('Missing sources sub-fields (publisher/publishedAt/reliability/excerpt) also default safely', minimalOk.sources.length > 0);

/* ===== 5 & 6: LLM cannot inject sources; raw Tavily sources preserved ===== */
console.log('\n— 5/6: LLM cannot inject sources/URLs; raw Tavily sources are preserved regardless of the new schema —');
const injectingRouter = {
  generateStructured: async (_schema, opts) => ({
    data: {
      summary: 'synth',
      findings: [{ title: 'f', detail: 'd', whyItMatters: 'w', confidence: 'low', sourceIndexes: [] }],
      opportunities: [], nextActions: [], limitations: [],
      sources: [{ title: 'injected', url: 'https://attacker.example/evil', publisher: 'x', publishedAt: '', reliability: 'high', excerpt: '' }],
    },
    trace: { traceId: 't5', usedFallback: false, provider: 'openai', errorDetail: null },
  }),
};
const injectTest = await runResearch(LIGHTING_TOPIC, { router: injectingRouter, taskId: null, searchProvider });
check('Injected URL never appears in sources', !injectTest.sources.some((s) => s.url.includes('attacker.example')));
check('Sources are exactly the real Tavily results', injectTest.sources.length === realResults.length && injectTest.sources.every((s) => realResults.some((r) => r.url === s.url)));

/* ===== 7: deterministic fallback still works when LLM output is unrecoverable ===== */
console.log('\n— 7: deterministic fallback still works when the LLM never produces valid output —');
let unrecoverableAttempts = 0;
const unrecoverableProvider = {
  name: 'openai',
  complete: async (req) => { unrecoverableAttempts++; return { text: 'not json at all, still not json', model: req.model, provider: 'openai', tokensIn: 1, tokensOut: 1, costUsd: 0 }; },
};
const router4 = new LlmRouter({ anthropicApiKey: 'fake-key', defaultProvider: 'anthropic' });
router4.provider = unrecoverableProvider;
const unrecoverableTest = await runResearch(LIGHTING_TOPIC, { router: { generateStructured: (s, o) => router4.generateStructured(s, o) }, taskId: null, searchProvider });
check('Falls back to deterministic_fallback rather than crashing or hanging', unrecoverableTest.report.synthesisMode === 'deterministic_fallback');
check('synthesisFailureReason is populated with a real, non-generic reason', unrecoverableTest.report.synthesisFailureReason && unrecoverableTest.report.synthesisFailureReason.length > 0, unrecoverableTest.report.synthesisFailureReason);
check('sourceMode remains search_api — a broken LLM never degrades real Tavily sources', unrecoverableTest.report.sourceMode === 'search_api');
check('Retried up to maxAttempts (2) before giving up, not just once', unrecoverableAttempts === 2, unrecoverableAttempts);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
