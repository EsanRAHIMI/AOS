#!/usr/bin/env node
/**
 * Phase AE smoke — Jarvis Memory, Daily Brain & Real Context Upgrade.
 * Drives the REAL shared engines with fixed inputs (deterministic fallback
 * path — no LLM key required). Covers: bilingual memory-fact extraction
 * (item 1), priority ranking + daily brain packet (items 2-3), decisions/
 * blockers summary (item 4), answer quality scoring (item 5), task
 * completion summaries that never soften failure (item 6), and the
 * fallback daily briefing composer (item 7).
 * Run from repo root after building shared: node scripts/phaseae-jarvis-brain-smoke.mjs
 */
import {
  extractMemoryFactsFallback, buildMemoryFacts, JarvisMemoryFactSchema,
  rankPriorities, summarizeDecisionsAndBlockers, buildDailyBrainPacket,
  composeDailyBriefingFallback, JarvisBriefingSchema,
  scoreJarvisAnswer, JarvisAnswerScoreSchema,
  composeTaskCompletionFallback, JarvisCompletionSummarySchema,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade smoke\n');

console.log('— Item 1: bilingual memory-fact extraction (fallback, deterministic) —');
const decEn = extractMemoryFactsFallback("I've decided to focus on the AOS kernel this month, blocked by unclear Dokploy domain setup.");
check('EN decision fact extracted', decEn.facts.some((f) => f.kind === 'decision'), JSON.stringify(decEn));
check('EN blocker fact extracted', decEn.facts.some((f) => f.kind === 'blocker'), JSON.stringify(decEn));
const decFa = extractMemoryFactsFallback('تصمیم گرفتم روی هسته AOS تمرکز کنم. منتظر تایید دامنه هستم.');
check('FA decision fact extracted', decFa.facts.some((f) => f.kind === 'decision'), JSON.stringify(decFa));
check('FA blocker fact extracted', decFa.facts.some((f) => f.kind === 'blocker'), JSON.stringify(decFa));
const noFacts = extractMemoryFactsFallback('what is my system status now?');
check('Non-declarative message extracts no invented facts (honest empty list)', noFacts.facts.length === 0, JSON.stringify(noFacts));
const built = buildMemoryFacts({ turnId: 'jturn_test', actorId: 'esan', scope: 'user', result: decEn, usedLlm: false });
check('Built facts are schema-valid and quote the real sentence (never invented)', built.every((f) => JarvisMemoryFactSchema.safeParse(f).success) && built.every((f) => decEn.facts.some((raw) => raw.content === f.content)));
check('Fallback facts are tagged with the correct source', built.every((f) => f.source === 'turn_extraction_fallback'));

console.log('— Items 2-3: daily brain packet + priority ranking —');
const brainInput = {
  actorName: 'Esan', scope: 'user', safeMode: false, pendingApprovals: 2,
  activeTasks: [
    { taskId: 't1', goal: 'Wire gateway-api Jarvis briefing endpoint', status: 'in_progress', priority: 'high', createdAt: '2026-07-08T00:00:00.000Z' },
    { taskId: 't2', goal: 'Fix stale personal-smoke assertion', status: 'blocked', priority: 'low', createdAt: '2026-07-01T00:00:00.000Z' },
  ],
  activeProjects: [
    { projectId: 'p1', title: 'AOS Kernel', incomePotential: 'high', status: 'active' },
    { projectId: 'p2', title: 'Dormant idea', incomePotential: 'low', status: 'paused' },
  ],
  openIncidents: [{ incidentId: 'i1', title: 'Registry flaky', severity: 'critical' }],
  personalRisks: [{ riskId: 'r1', title: 'Single income stream', severity: 'high', mitigation: '' }],
  recentDecisions: [{ decisionId: 'd1', goal: 'Ship Phase AE', selectedReason: 'Improves grounding quality', createdAt: '2026-07-09T00:00:00.000Z' }],
  recentMemoryFacts: [{ kind: 'blocker', content: 'Waiting on Dokploy domain approval', createdAt: '2026-07-09T00:00:00.000Z' }],
  nextBestActions: [{ title: 'Finish Jarvis briefing endpoint', reason: 'Unblocks daily command briefing', priorityScore: 9.2 }],
};
const ranked = rankPriorities(brainInput);
check('Ranking is deterministic and non-empty', ranked.length > 0);
check('Ranking is sorted by weight descending', ranked.every((r, i) => i === 0 || ranked[i - 1].weight >= r.weight));
check('Paused project is excluded from ranking (only active projects count)', !ranked.some((r) => r.label === 'Dormant idea'));
const { decisions, blockers } = summarizeDecisionsAndBlockers(brainInput);
check('Item 4: recent decision surfaced', decisions.some((d) => d.includes('Ship Phase AE')), JSON.stringify(decisions));
check('Item 4: critical incident surfaced as blocker', blockers.some((b) => b.includes('Registry flaky')), JSON.stringify(blockers));
check('Item 4: high-severity personal risk surfaced as blocker', blockers.some((b) => b.includes('Single income stream')), JSON.stringify(blockers));
check('Item 4: extracted memory blocker fact surfaced too', blockers.some((b) => b.includes('Dokploy domain approval')), JSON.stringify(blockers));
const packet = buildDailyBrainPacket(brainInput);
check('Daily brain packet compact summary is grounded (mentions a real task, not generic filler)', packet.compactSummary.includes('Wire gateway-api Jarvis briefing endpoint'));
check('Daily brain packet is honest about pending approvals', packet.compactSummary.includes('Approvals pending: 2'));

console.log('— Item 7: daily briefing composer (fallback, deterministic, bilingual) —');
const briefEn = composeDailyBriefingFallback({ packet, language: 'en' });
check('EN briefing is schema-valid', JarvisBriefingSchema.safeParse(briefEn).success);
check('EN briefing cites a real top priority, not invented text', briefEn.topPriorities.length > 0 && packet.prioritizedItems.some((p) => briefEn.topPriorities.includes(p.label)));
check('EN briefing surfaces the real blocker count honestly', briefEn.headline.includes(String(packet.blockers.length)));
const briefFa = composeDailyBriefingFallback({ packet, language: 'fa' });
check('FA briefing responds in Persian', briefFa.language === 'fa' && /[؀-ۿ]/.test(briefFa.narrative));

console.log('— Item 5: answer quality scoring (pure, deterministic) —');
const goodScore = scoreJarvisAnswer({
  turnId: 'jturn_1', replyText: 'Top priority: wire the Jarvis briefing endpoint — 2 approvals are pending.',
  replyLanguage: 'en', groundedIn: ['top_next_action'], suggestedFollowUpsCount: 2,
  intentLanguage: 'en', intentCategory: 'system_status', packetLabels: ['top_next_action', 'safe_mode'], packetHasNotConfigured: false,
});
check('Grounded, specific, actionable answer scores well', JarvisAnswerScoreSchema.safeParse(goodScore).success && goodScore.overall > 0.8, JSON.stringify(goodScore));
const badScore = scoreJarvisAnswer({
  turnId: 'jturn_2', replyText: 'I heard: hello', replyLanguage: 'en', groundedIn: ['nonexistent_label'],
  suggestedFollowUpsCount: 0, intentLanguage: 'fa', intentCategory: 'personal_life_planning',
  packetLabels: ['calendar_connector'], packetHasNotConfigured: true,
});
check('Generic, mislabeled, mismatched-language answer scores poorly', badScore.overall < 0.5, JSON.stringify(badScore));
check('Bad score records honest issues (groundedIn label mismatch)', badScore.issues.some((i) => i.includes('do not exist in the context packet')));
check('Bad score flags the language mismatch', badScore.issues.some((i) => i.includes('does not match')));
const ungroundedScore = scoreJarvisAnswer({
  turnId: 'jturn_3', replyText: 'Sure, I can help with your calendar and schedule for today.', replyLanguage: 'en',
  groundedIn: [], suggestedFollowUpsCount: 1, intentLanguage: 'en', intentCategory: 'schedule_calendar',
  packetLabels: ['calendar_connector'], packetHasNotConfigured: true,
});
check('Score flags a hidden not_configured item when the reply claims to help without citing it', ungroundedScore.issues.some((i) => i.includes('not_configured')), JSON.stringify(ungroundedScore));

console.log('— Item 6: task completion summary composer (fallback, never softens failure) —');
const completedSummary = composeTaskCompletionFallback({
  goal: 'Wire the Jarvis briefing endpoint', status: 'completed',
  observations: ['Endpoint added.', 'Typecheck clean.'], reportSummary: 'Endpoint added and typechecked clean.',
  evidenceCount: 2, language: 'en',
});
check('Completed summary is schema-valid', JarvisCompletionSummarySchema.safeParse(completedSummary).success);
check('Completed summary reports success honestly', completedSummary.reply.toLowerCase().startsWith('done'));
const failedSummary = composeTaskCompletionFallback({
  goal: 'Deploy to production', status: 'failed',
  observations: ['Health check failed.'], reportSummary: 'Deploy failed: health check did not pass.',
  evidenceCount: 1, language: 'en',
});
check('Failed summary is reported as FAILED, never as success', failedSummary.reply.toLowerCase().startsWith('failed'));
check('Failed summary quotes the real reportSummary, not invented text', failedSummary.reply.includes('health check did not pass'));
const failedSummaryFa = composeTaskCompletionFallback({
  goal: 'دیپلوی به سرور', status: 'failed', observations: [], reportSummary: 'بررسی سلامت شکست خورد.', evidenceCount: 0, language: 'fa',
});
check('FA failed summary is also honestly reported as failed (not softened for language)', failedSummaryFa.reply.startsWith('ناموفق بود'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
