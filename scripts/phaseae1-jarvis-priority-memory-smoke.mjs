#!/usr/bin/env node
/**
 * Phase AE.1 smoke — Jarvis Priority & Memory Correction.
 *
 * Replays the EXACT real Persian conversation that exposed the bug: Jarvis
 * kept repeating "fix service-registry / file-asset-service" instead of the
 * owner's explicitly-stated priority ("fix the Jarvis brain and AOS home
 * page"). Root cause (see docs/decision-log.md D-1xx): gatherJarvisFacts
 * never read jarvis_memory_facts back into context, the priority-extraction
 * regex was too narrow, and composeJarvisResponseFallback's meta_self_assessment
 * branch ignored the context packet entirely.
 *
 * This smoke test chains the REAL pure shared functions the same way the
 * gateway wires them (extract → build fact → pick active priority → inject
 * into context facts → build packet → classify intent → compose reply),
 * with a hand-built "system health" fact block that reproduces the exact
 * noisy state from the real conversation (service-registry + file-asset-
 * service unhealthy) — so a pass here means the fix generalizes to the real
 * pipeline, not just a synthetic best-case.
 *
 * Run from repo root after building shared: node scripts/phaseae1-jarvis-priority-memory-smoke.mjs
 */
import {
  extractMemoryFactsFallback, buildMemoryFacts, pickActivePriorityFact,
  buildJarvisContextPacket, classifyIntentFallback, composeJarvisResponseFallback,
  answerIgnoresStatedPriority,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AE.1 — Jarvis Priority & Memory Correction smoke\n');

// --- Turn A: the owner states their priority explicitly ---------------------
console.log('— Turn A: "یادت باشه اولویت من الان درست کردن مغز Jarvis و صفحه اول AOS است" —');
const turnAText = 'یادت باشه اولویت من الان درست کردن مغز Jarvis و صفحه اول AOS است';
const extractionA = extractMemoryFactsFallback(turnAText);
check('A priority fact is extracted', extractionA.facts.some((f) => f.kind === 'priority'), JSON.stringify(extractionA));
const memFactsA = buildMemoryFacts({ turnId: 'jturn_a', actorId: 'esan', scope: 'user', result: extractionA, usedLlm: false, language: 'fa' });
check('Extracted fact is persistable and schema-valid', memFactsA.length > 0);
check('Priority fact carries high importance (outranks a passive preference/fact)', memFactsA.find((f) => f.kind === 'priority')?.importance >= 0.9, JSON.stringify(memFactsA));
check('Priority fact records the source language (fa)', memFactsA.find((f) => f.kind === 'priority')?.language === 'fa');
const priorityFactA = pickActivePriorityFact(memFactsA);
check('pickActivePriorityFact returns it as the active priority', priorityFactA?.content === memFactsA.find((f) => f.kind === 'priority').content);

// Simulate the persisted memory store growing across the conversation — every
// subsequent turn re-reads this the way gatherJarvisFacts does in the gateway.
const memoryStore = [...memFactsA];

// Build the noisy "system health" facts EXACTLY as the real conversation had
// them — this is the regression bait: if priority ranking is still broken,
// these will win.
const systemHealthFacts = [
  { label: 'open_incidents', detail: 'service-registry unhealthy; file-asset-service unhealthy', status: 'known', weight: 9, href: '/incidents' },
  { label: 'pending_approvals', detail: '0', status: 'known', weight: 1, href: '/approvals' },
  { label: 'safe_mode', detail: 'off', status: 'known', weight: 2 },
];

/** Mirrors gatherJarvisFacts' Phase AE.1 memory-injection block exactly. */
function factsWithMemory(intentCategory) {
  const facts = [...systemHealthFacts];
  const active = pickActivePriorityFact(memoryStore);
  if (active) facts.push({ label: 'user_priority', detail: active.content, status: 'known', weight: 20, href: '/me' });
  for (const bf of memoryStore.filter((f) => f.kind === 'blocker').slice(0, 3)) facts.push({ label: 'user_blocker', detail: bf.content, status: 'known', weight: 12 });
  if (intentCategory === 'meta_self_assessment') {
    facts.push({ label: 'highest_leverage_next_step', detail: 'Wire a real search/fetch provider into internet-research-service, then add CI.', status: 'known', weight: 6 });
  }
  return facts;
}

const NOT_PRIMARY_SERVICE_HEALTH = /اولویت (شما|فعلی)[^.؟]*(service-registry|file-asset-service)/i;

// --- Turn B: "اولویت فعلی من چیه؟" -----------------------------------------
console.log('— Turn B: "اولویت فعلی من چیه؟" —');
const intentB = classifyIntentFallback('اولویت فعلی من چیه؟');
const packetB = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts: factsWithMemory(intentB.category) });
const replyB = composeJarvisResponseFallback({ text: 'اولویت فعلی من چیه؟', intent: intentB, packet: packetB });
check('B mentions the real stated priority (Jarvis brain / AOS home page)', replyB.reply.includes('مغز Jarvis') || replyB.reply.includes('صفحه اول'), replyB.reply);
check('B does NOT claim service-registry/file-asset-service as the primary priority', !NOT_PRIMARY_SERVICE_HEALTH.test(replyB.reply), replyB.reply);
check('B groundedIn cites user_priority (structurally grounded, not incidental phrasing)', replyB.groundedIn.includes('user_priority'), JSON.stringify(replyB.groundedIn));
check('B structured primaryPriority field is populated correctly', replyB.primaryPriority.includes('مغز Jarvis'), replyB.primaryPriority);

// --- Turn C: "امروز مهم‌ترین کاری که باید انجام بدم چیه؟" ------------------
console.log('— Turn C: "امروز مهم‌ترین کاری که باید انجام بدم چیه؟" —');
const intentC = classifyIntentFallback('امروز مهم‌ترین کاری که باید انجام بدم چیه؟');
const packetC = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts: factsWithMemory(intentC.category) });
const replyC = composeJarvisResponseFallback({ text: 'امروز مهم‌ترین کاری که باید انجام بدم چیه؟', intent: intentC, packet: packetC });
check('C primary priority is the Jarvis brain/home page work, not service health', replyC.reply.includes('مغز Jarvis') || replyC.reply.includes('صفحه اول'), replyC.reply);
check('C does NOT present service-registry/file-asset-service as the primary priority', !NOT_PRIMARY_SERVICE_HEALTH.test(replyC.reply), replyC.reply);
check('C still surfaces the unhealthy services as a secondary blocker (not silently dropped)', replyC.reply.includes('service-registry') || replyC.activeBlockers.some((b) => b.includes('service-registry')), replyC.reply);

// --- Turn D: "چه تصمیم‌ها و بلاکرهای مهمی الان دارم؟" ----------------------
console.log('— Turn D: "چه تصمیم‌ها و بلاکرهای مهمی الان دارم؟" —');
const intentD = classifyIntentFallback('چه تصمیم‌ها و بلاکرهای مهمی الان دارم؟');
check('D no longer falls through to general_conversation (real category found)', intentD.category !== 'general_conversation', JSON.stringify(intentD));
const packetD = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts: factsWithMemory(intentD.category) });
const replyD = composeJarvisResponseFallback({ text: 'چه تصمیم‌ها و بلاکرهای مهمی الان دارم؟', intent: intentD, packet: packetD });
check('D decision/priority is Jarvis brain + home page', replyD.reply.includes('مغز Jarvis') || replyD.reply.includes('صفحه اول'), replyD.reply);
check('D blockers section names the unhealthy services', replyD.activeBlockers.some((b) => b.includes('service-registry')) || replyD.reply.includes('service-registry'), replyD.reply);

// --- Turn E: "برای AOS قدم بعدی چیه؟" --------------------------------------
console.log('— Turn E: "برای AOS قدم بعدی چیه؟" —');
const intentE = classifyIntentFallback('برای AOS قدم بعدی چیه؟');
check('E classified as meta_self_assessment', intentE.category === 'meta_self_assessment', JSON.stringify(intentE));
const packetE = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts: factsWithMemory(intentE.category) });
const replyE = composeJarvisResponseFallback({ text: 'برای AOS قدم بعدی چیه؟', intent: intentE, packet: packetE });
check('E next step is grounded in the real stated priority (Jarvis brain/memory/home contract), not the canned self-knowledge text', replyE.reply.includes('مغز Jarvis') || replyE.reply.includes('صفحه اول'), replyE.reply);
check('E does NOT answer with only "رفع service-registry" as the step', !NOT_PRIMARY_SERVICE_HEALTH.test(replyE.reply), replyE.reply);

// --- meta_self_assessment WITHOUT a stated priority still uses the honest
//     canned self-knowledge text (Phase AD behavior — must not regress) -----
console.log('— Regression: meta_self_assessment with NO stated priority is unchanged —');
const bareIntent = classifyIntentFallback('برای AOS قدم بعدی چیه؟');
const barePacket = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'global', facts: [{ label: 'safe_mode', detail: 'off', status: 'known', weight: 2 }] });
const bareReply = composeJarvisResponseFallback({ text: 'برای AOS قدم بعدی چیه؟', intent: bareIntent, packet: barePacket });
check('No priority fact present → falls back to AOS_SELF_KNOWLEDGE text (Phase AD behavior preserved)', bareReply.groundedIn.includes('AOS_SELF_KNOWLEDGE'), JSON.stringify(bareReply.groundedIn));

// --- system_status is exempt from the priority-FIRST OVERRIDE TEMPLATE: a
//     pure health question still gets the "Current status: ..." format, not
//     the "Your current priority: ... Active blocker(s): ..." template. The
//     priority fact is still allowed to appear in the status listing itself
//     (it's legitimately the highest-weighted real fact — the ranking table
//     in the spec puts explicit priority above even a critical outage), just
//     not wrapped in the priority-specific narrative structure. ------------
console.log('— system_status is exempt from the priority-first override template —');
const statusIntent = classifyIntentFallback('الان وضعیت سیستم من چیه؟');
const statusPacket = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts: factsWithMemory(statusIntent.category) });
const statusReply = composeJarvisResponseFallback({ text: 'الان وضعیت سیستم من چیه؟', intent: statusIntent, packet: statusPacket });
check('A pure system-status question keeps the status-report format, not the priority/blocker narrative template', statusReply.reply.startsWith('وضعیت الان:') && !statusReply.reply.includes('بلاکر(های) فنی فعلی'), statusReply.reply);
check('...but the structured primaryPriority field is left empty (override template did not run)', statusReply.primaryPriority === '', statusReply.primaryPriority);

// --- correction gate: an LLM-style answer that ignores the stated priority --
console.log('— Correction gate: answerIgnoresStatedPriority —');
const badLlmAnswer = { reply: 'باید سرویس‌های service-registry و file-asset-service را بررسی کنید.', groundedIn: ['open_incidents'] };
check('Ignoring a present user_priority fact is detected', answerIgnoresStatedPriority(badLlmAnswer, packetB), 'expected true');
const goodLlmAnswer = { reply: 'اولویت شما اصلاح مغز Jarvis و صفحه اول AOS است.', groundedIn: ['user_priority'] };
check('An answer that grounds in user_priority is NOT flagged', !answerIgnoresStatedPriority(goodLlmAnswer, packetB), 'expected false');
const noPriorityPacket = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'global', facts: systemHealthFacts });
check('No user_priority fact in the packet → never flagged (nothing to ignore)', !answerIgnoresStatedPriority(badLlmAnswer, noPriorityPacket));

// --- restated priority supersedes the old one (recency-based supersession) --
console.log('— A newly-stated priority supersedes the old one —');
const turnFText = 'یادت باشه الان اولویت من رفع باگ‌های دیتابیس است';
const extractionF = extractMemoryFactsFallback(turnFText);
const memFactsF = buildMemoryFacts({ turnId: 'jturn_f', actorId: 'esan', scope: 'user', result: extractionF, usedLlm: false, language: 'fa' })
  // Force a later timestamp deterministically — two buildMemoryFacts() calls
  // in the same synchronous script can land in the same millisecond, and
  // recency is the whole supersession mechanism being tested here.
  .map((f) => ({ ...f, createdAt: new Date(Date.now() + 60_000).toISOString() }));
memoryStore.push(...memFactsF);
const newActive = pickActivePriorityFact(memoryStore);
check('The newer priority statement is now the active one', newActive?.content.includes('دیتابیس'), newActive?.content);
check('The older Jarvis-brain priority is no longer picked as active', !newActive?.content.includes('مغز Jarvis'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
