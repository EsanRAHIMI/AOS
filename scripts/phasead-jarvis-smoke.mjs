#!/usr/bin/env node
/**
 * Phase AD smoke — Jarvis Intelligence Core & Living Command Home.
 * Drives the REAL shared engines with fixed inputs (deterministic fallback
 * path — no LLM key required to run this in CI/sandbox). Covers: bilingual
 * (EN/FA) intent classification, mode routing, context-packet honesty
 * (not_configured never hidden), grounded response composition (never
 * fabricates outside the supplied packet), the quality-bar prompts A–E at
 * the planning/classification level, and the "create a task" planner branch.
 * Run from repo root after building shared: node scripts/phasead-jarvis-smoke.mjs
 */
import {
  classifyIntentFallback, detectLanguage, decideJarvisMode, buildJarvisContextPacket,
  composeJarvisResponseFallback, AOS_SELF_KNOWLEDGE, JarvisIntentSchema, JarvisResponseSchema,
  planForGoal, classifyGoalScope,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AD — Jarvis Intelligence Core smoke\n');

console.log('— Language detection —');
check('Persian detected', detectLanguage('الان وضعیت سیستم من چیه؟') === 'fa');
check('English detected', detectLanguage('what is my system status now?') === 'en');

console.log('— Quality-bar prompt A: system status (EN + FA) —');
const iaFa = classifyIntentFallback('الان وضعیت سیستم من چیه؟');
check('FA system-status classified correctly', iaFa.category === 'system_status' && iaFa.language === 'fa', JSON.stringify(iaFa));
const iaEn = classifyIntentFallback("What's my system status now?");
check('EN system-status classified correctly', iaEn.category === 'system_status' && iaEn.language === 'en');
check('system_status routes to direct_answer (no fake tool session)', decideJarvisMode(iaFa) === 'direct_answer');
check('JarvisIntent is schema-valid', JarvisIntentSchema.safeParse(iaFa).success);

console.log('— Quality-bar prompt B: most important task today (FA) —');
const ib = classifyIntentFallback('امروز مهم‌ترین کاری که باید انجام بدم چیه؟');
check('FA personal-planning classified correctly', ib.category === 'personal_life_planning', JSON.stringify(ib));
check('personal_life_planning routes through the existing planner (real tools, not a shortcut)', decideJarvisMode(ib) === 'route_to_planner');

console.log('— Quality-bar prompt C: why isn\'t this real Jarvis (FA) —');
const ic = classifyIntentFallback('چرا این سیستم هنوز مثل Jarvis واقعی نیست؟');
check('FA meta-self-assessment classified correctly', ic.category === 'meta_self_assessment', JSON.stringify(ic));
check('meta_self_assessment answers directly, grounded in AOS_SELF_KNOWLEDGE', decideJarvisMode(ic) === 'direct_answer');
const metaPacket = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'global', facts: [{ label: 'safe_mode', detail: 'off', status: 'known', weight: 2 }] });
const metaAnswer = composeJarvisResponseFallback({ text: 'چرا این سیستم هنوز مثل Jarvis واقعی نیست؟', intent: ic, packet: metaPacket });
check('Self-assessment reply is honest and specific (mentions a real known gap, not generic praise)', AOS_SELF_KNOWLEDGE.knownGaps.some((g) => metaAnswer.reply.includes(g.split(' — ')[0].split('.')[0].slice(0, 20)) || metaAnswer.reply.includes(g)));
check('Self-assessment reply is in Persian for a Persian question', metaAnswer.language === 'fa');
check('JarvisResponse is schema-valid', JarvisResponseSchema.safeParse(metaAnswer).success);

console.log('— Quality-bar prompt D: next step for AOS (FA) —');
const id = classifyIntentFallback('برای AOS قدم بعدی چیه؟');
check('FA "what next for AOS" classified as meta_self_assessment', id.category === 'meta_self_assessment', JSON.stringify(id));
const nextStepAnswer = composeJarvisResponseFallback({ text: 'برای AOS قدم بعدی چیه؟', intent: id, packet: metaPacket });
check('Next-step reply quotes the real highest-leverage step, not an invented one', nextStepAnswer.reply.includes(AOS_SELF_KNOWLEDGE.highestLeverageNextStep) || AOS_SELF_KNOWLEDGE.highestLeverageNextStep.split('.')[0].split(',').every((frag) => nextStepAnswer.reply.includes(frag.trim().slice(0, 15))));

console.log('— Quality-bar prompt E: create a task to fix the homepage/Jarvis brain (FA) —');
const ie = classifyIntentFallback('یک تسک بساز که مشکل صفحه اول و مغز Jarvis را حل کند');
check('FA task-creation phrase classified (approvals_tasks bucket, routes to planner)', ie.category === 'approvals_tasks' && decideJarvisMode(ie) === 'route_to_planner', JSON.stringify(ie));
const planE = planForGoal('یک تسک بساز که مشکل صفحه اول و مغز Jarvis را حل کند', { safeMode: false, role: 'owner' });
check('Planner actually routes to the create_task tool (real orchestrator hand-off)', planE.kind === 'runtime_goal' && planE.steps.some((s) => s.toolId === 'create_task'), JSON.stringify(planE));
const planEEn = planForGoal('Create a task that fixes the homepage and Jarvis brain problem', { safeMode: false, role: 'owner' });
check('English phrasing also routes to create_task', planEEn.steps.some((s) => s.toolId === 'create_task'));
check('Scope classification for a task-creation goal stays global kernel work', classifyGoalScope('یک تسک بساز که مشکل صفحه اول و مغز Jarvis را حل کند').scope === 'global');

console.log('— Context packet: honesty (not_configured is never hidden) —');
const honestPacket = buildJarvisContextPacket({
  actorName: 'Esan', isOwner: true, scope: 'user',
  facts: [
    { label: 'calendar_connector', detail: 'not_configured', status: 'not_configured', weight: 3 },
    { label: 'top_next_action', detail: 'Mitigate risk: single income stream', status: 'known', weight: 9 },
    { label: 'safe_mode', detail: 'off', status: 'known', weight: 1 },
  ],
});
check('Packet ranks by weight (highest first)', honestPacket.ranked[0].label === 'top_next_action');
check('not_configured status is preserved in the compact summary (never silently dropped)', honestPacket.compactSummary.includes('[not_configured]'));
check('notConfiguredCount counts honestly', honestPacket.notConfiguredCount === 1);
const finalIntent = classifyIntentFallback('my goal is to earn more this month');
const honestAnswer = composeJarvisResponseFallback({ text: 'my goal is to earn more this month', intent: finalIntent, packet: honestPacket });
check('Composed answer surfaces the not_configured item instead of inventing calendar data', honestAnswer.reply.toLowerCase().includes('calendar') || honestAnswer.groundedIn.includes('calendar_connector') || honestAnswer.reply.includes('not_configured') || honestAnswer.reply.includes('not yet connected'));

console.log('— Context packet: caps to a compact, ranked list (never a full dump) —');
const manyFacts = Array.from({ length: 30 }, (_, i) => ({ label: `fact_${i}`, detail: `detail ${i}`, status: 'known', weight: i }));
const capped = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'global', facts: manyFacts });
check('Ranked list is capped (compact, not the full 30-fact dump)', capped.ranked.length < manyFacts.length && capped.ranked.length <= 14);
check('Cap keeps the highest-weight facts', capped.ranked[0].label === 'fact_29');

console.log('— General conversation never returns the old dead-end message —');
const generalIntent = classifyIntentFallback('hey, just checking in');
check('Unmatched chit-chat is honestly general_conversation, not misclassified', generalIntent.category === 'general_conversation');
check('general_conversation still answers directly (no session, no dead end)', decideJarvisMode(generalIntent) === 'direct_answer');
const generalPacket = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'global', facts: [{ label: 'system_check', detail: '2 services registered; 0 approvals pending; 0 open incidents; safe mode off.', status: 'known', weight: 10 }] });
const generalAnswer = composeJarvisResponseFallback({ text: 'hey, just checking in', intent: generalIntent, packet: generalPacket });
check('Reply is grounded in real facts, not the generic "I heard: ..." dead end', !generalAnswer.reply.startsWith('I heard:') && generalAnswer.reply.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
