/**
 * Phase AD — Jarvis Intelligence Core.
 *
 * Turns the operator/home experience from a pure regex command router into a
 * real (but still safety-bounded) reasoning layer:
 *  - intent classification (LLM + bilingual EN/FA deterministic fallback)
 *  - a compact, RANKED context packet built only from facts the caller supplies
 *    (never fetched or invented here — this module stays pure and testable)
 *  - a grounded response composer (LLM + deterministic fallback) that never
 *    answers with anything outside the supplied context packet
 *  - an honest, explicitly-maintained self-knowledge record for meta questions
 *    ("why isn't this real Jarvis yet", "what's next for AOS")
 *
 * Hard rule, unchanged from Phase X: raw LLM output NEVER executes a tool or
 * mutates state. This module only ever returns schema-validated structured
 * data. The existing deterministic planner (`../operator`) + approval gate
 * remain the only path from a decision to an actual action — Jarvis's LLM
 * layer only decides HOW TO TALK about what already happened/will happen,
 * and for read-only status questions, answers straight from real context.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { nowIso } from '../utils/index.js';
import type { LlmRouter } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';

/* ============================== intent ================================== */

export const JarvisIntentCategory = z.enum([
  'system_status',
  'personal_life_planning',
  'business_project',
  'finance_ops',
  'schedule_calendar',
  'email_communication',
  'research_opportunities',
  'code_development',
  'approvals_tasks',
  'memory_profile_capture',
  'meta_self_assessment',
  'general_conversation',
]);
export type JarvisIntentCategory = z.infer<typeof JarvisIntentCategory>;

export const JarvisLanguage = z.enum(['fa', 'en', 'other']);
export type JarvisLanguage = z.infer<typeof JarvisLanguage>;

export const JarvisIntentSchema = z.object({
  category: JarvisIntentCategory,
  language: JarvisLanguage,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().default(''),
});
export type JarvisIntent = z.infer<typeof JarvisIntentSchema>;

/** Very cheap language guess: presence of Arabic/Persian-range characters. */
export function detectLanguage(text: string): JarvisLanguage {
  if (/[؀-ۿ]/.test(text)) return 'fa';
  if (/[A-Za-z]/.test(text)) return 'en';
  return 'other';
}

interface CategoryPattern { category: JarvisIntentCategory; en: RegExp; fa: RegExp }

/** Ordered — first match wins. Bilingual on purpose: the owner speaks Persian. */
const CATEGORY_PATTERNS: CategoryPattern[] = [
  { category: 'meta_self_assessment', en: /why (isn'?t|is not) this|like a real jarvis|what'?s next for aos|next step for aos|what should aos build/i, fa: /چرا.*(جارویس|jarvis)|چرا.*(هوشمند نیست|واقعی نیست)|(قدم بعدی|مرحله بعد).*aos|aos.*(قدم بعدی|مرحله بعد)/i },
  { category: 'system_status', en: /system status|system health|whole system|is .*(up|down|reachable)|health check|check the system/i, fa: /وضعیت سیستم|سلامت سیستم|سیستم چطور|وضعیت الان|چک کن سیستم|سیستم رو چک/i },
  { category: 'approvals_tasks', en: /\bapprov|\btask\b|pending (approval|task)/i, fa: /تایید|تأیید|تسک|وظیفه|در انتظار/i },
  { category: 'code_development', en: /\bcode\b|\bbug\b|deploy|typecheck|\bbuild\b|repo|repository|create .*(service|agent)/i, fa: /کد نویسی|باگ|دیپلوی|ریپو|سرویس بساز/i },
  { category: 'research_opportunities', en: /research|opportunit|best practice|market|investigate/i, fa: /تحقیق|فرصت|بازار|بررسی کن/i },
  { category: 'finance_ops', en: /\bfinance|budget|income|expense|invoice|money\b/i, fa: /مالی|بودجه|درآمد|هزینه|قبض|پول/i },
  { category: 'schedule_calendar', en: /calendar|appointment|\bmeeting\b|schedule (a|my)/i, fa: /تقویم|قرار ملاقات|جلسه/i },
  { category: 'email_communication', en: /\bemail\b|inbox|send .*(message|email)/i, fa: /ایمیل|پیام بفرست|ارسال ایمیل/i },
  { category: 'memory_profile_capture', en: /my goal is|remember that|my role is|my focus is|i want to|i need to/i, fa: /هدف من|یادت باشه|نقش من|تمرکز من|می‌خوام|میخوام/i },
  { category: 'business_project', en: /\bproject\b|\bventure\b|\bbusiness\b/i, fa: /پروژه|کسب.?وکار|ونچر/i },
  // Phase AE.1 — added تصمیم/بلاکر/مانع so "چه تصمیم‌ها و بلاکرهای مهمی الان
  // دارم؟" classifies as a real category instead of falling through to
  // general_conversation (which pulled in raw system-health facts).
  { category: 'personal_life_planning', en: /\b(my|me)\b.*(day|week|schedule|priorit|goals?)|what should i do|plan my (day|week)|most important (thing|task)|decisions? (and|or) blockers?|what.*blockers?.*(do i|i) have/i, fa: /امروز چیکار|کار مهم امروز|برنامه امروز|اولویت|چیکار باید|مهم‌ترین کار|تصمیم(‌ها)?|بلاکر(ها)?|مانع/i },
];

/** Deterministic bilingual fallback — used when no LLM key is configured or
 *  the model output fails schema validation. Never guesses wildly: anything
 *  unmatched is honestly 'general_conversation'. */
export function classifyIntentFallback(text: string): JarvisIntent {
  const language = detectLanguage(text);
  for (const p of CATEGORY_PATTERNS) {
    if (p.en.test(text) || p.fa.test(text)) {
      return { category: p.category, language, confidence: 0.6, reasoning: `deterministic keyword match (${p.category})` };
    }
  }
  return { category: 'general_conversation', language, confidence: 0.4, reasoning: 'no pattern matched — treated as general conversation' };
}

/** LLM-assisted classification with the deterministic fallback always as the
 *  safety net (generateStructured validates whichever path produced data). */
export async function classifyIntent(router: LlmRouter, text: string, opts: { taskId?: string | null; forceFallback?: boolean } = {}): Promise<{ intent: JarvisIntent; trace: unknown }> {
  const p = promptFor('jarvis:intent');
  const { data, trace } = await router.generateStructured(JarvisIntentSchema, {
    agentId: 'gateway-api',
    taskType: 'jarvis_intent_classification',
    system: p.system,
    prompt: `Classify this user message into exactly one category and detect its language.\nCategories: ${JarvisIntentCategory.options.join(', ')}\nMessage: """${text}"""\nRespond as JSON: {"category":"...","language":"fa|en|other","confidence":0..1,"reasoning":"short"}`,
    taskId: opts.taskId ?? null,
    fallback: () => classifyIntentFallback(text),
    fast: true,
    promptVersion: p.version,
    forceFallback: opts.forceFallback,
  });
  return { intent: data, trace };
}

/* ============================ mode routing =============================== */

export type JarvisMode = 'direct_answer' | 'route_to_planner';

/** Categories that are answered straight from the context packet — no tool
 *  session, no fake execution, just an honest grounded read. Everything else
 *  goes through the EXISTING deterministic planner/approval pipeline
 *  unchanged; Jarvis only composes the final reply around its real result. */
const DIRECT_ANSWER_CATEGORIES: ReadonlySet<JarvisIntentCategory> = new Set(['system_status', 'meta_self_assessment', 'general_conversation']);

export function decideJarvisMode(intent: JarvisIntent): JarvisMode {
  return DIRECT_ANSWER_CATEGORIES.has(intent.category) ? 'direct_answer' : 'route_to_planner';
}

/* ============================ self-knowledge ============================= */

/** Honest, explicitly-maintained facts about AOS's own current limitations
 *  and next step. Grounds meta questions ("why isn't this real Jarvis",
 *  "what's next") in real, verifiable state instead of invented confidence.
 *  Update this alongside phase-log/decision-log — it is documentation, not
 *  a model guess. */
export const AOS_SELF_KNOWLEDGE = {
  updatedAt: '2026-07-17',
  currentPhase: 'K2 Real Intelligence (D-177) — shared agent loop + persistent Jarvis + Memory v2 + missions + independent research',
  recentlyFixed: [
    'The deterministic "fake center" is replaced by ONE governed multi-turn agent loop (shared/src/agentcore): native provider tool calling, step budgets, wall-clock/token/cost limits, cancellation, explicit stop reasons, step-level traces, and — critically — approval PAUSE with EXACT resume from persisted state. Jarvis, the orchestrator and specialist roles all run on this one loop; raw model text still never mutates state (only governed tools do).',
    'Jarvis is now a persistent operating interface: durable jarvis_sessions/turns with a rolling summary, pinned facts and active mission links that survive reloads and restarts. Memory v2 (memory_records) actually changes later answers — a fact stored in one session is retrieved (hybrid lexical + optional local vector, bilingual FA/EN) and grounds a NEW session\'s reply; owner can inspect/correct/pin/delete, with provenance and confirmed/inferred/temporary status.',
    'A durable mission hierarchy (vision→objective→program→mission→plan→task→action) with parent-type integrity, a duplicate guard, and stall/overdue detection. Jarvis builds and updates it from natural language through governed tools.',
    'Research is now local-first and self-hostable (SearXNG preferred; direct fetch/RSS/sitemap always work; robots.txt honored; provenance ledger with publication + retrieval dates). Tavily is demoted to an OPTIONAL adapter — never a runtime requirement.',
  ],
  knownGaps: [
    'The /jarvis dashboard workspace is code-complete and typecheck-clean but has not yet been click-verified in a logged-in browser (the build sandbox has no browser). The API tier IS runtime-verified end-to-end (scripts/jarvis-http-verify.mjs, 7/7, through the real gateway process).',
    'Deep multi-source research synthesis and the full reviewer/QA self-development loop are code-complete with tested primitives; exercising them across many live web sources / a real merge needs a networked environment.',
    'Cloud model keys are OPTIONAL: with none set, Jarvis runs in honest degraded mode (reasoningMode:none) — personal state, memory, missions and local research still work fully. A self-hosted local model (LLM_LOCAL_BASE_URL, e.g. Ollama) is the recommended independence default.',
    'Personal connectors (calendar, email, finance) remain not_configured — only what the owner tells AOS directly, or self-hosted research, is ingested.',
  ],
  highestLeverageNextStep: 'Point LLM_LOCAL_BASE_URL at a self-hosted model (or set a cloud key) and SEARXNG_BASE_URL at a self-hosted SearXNG (deployment/searxng.md), then use the /jarvis workspace daily; next engineering step is click-verifying the dashboard UI and running the self-development loop against a real branch merge in a networked environment.',
} as const;

/* ============================= context packet ============================= */

export const JarvisContextStatus = z.enum(['known', 'not_configured', 'stale', 'unknown']);
export type JarvisContextStatus = z.infer<typeof JarvisContextStatus>;

/** One fact the caller (gateway) has already fetched from real state. Nothing
 *  in this module invents or fetches data — it only ranks/compacts what it is
 *  given, so the packet can never contain fabricated information. */
export interface JarvisContextFact {
  label: string;
  detail: string;
  status: JarvisContextStatus;
  /** Higher = more relevant right now (risk/urgency-weighted). */
  weight: number;
  href?: string;
}

export interface JarvisContextInput {
  actorName: string;
  isOwner: boolean;
  scope: 'global' | 'user';
  facts: JarvisContextFact[];
}

export interface JarvisContextPacket {
  generatedAt: string;
  actorName: string;
  scope: 'global' | 'user';
  /** Ranked, deduped, capped — never the full raw fact list. */
  ranked: JarvisContextFact[];
  /** Compact text block — what the LLM (or the fallback composer) actually reads. */
  compactSummary: string;
  knownCount: number;
  notConfiguredCount: number;
}

const MAX_RANKED_FACTS = 14;

/** Pure ranking/compaction — same input ⇒ same output. Caps to a compact,
 *  ranked packet instead of dumping everything the gateway knows. */
export function buildJarvisContextPacket(input: JarvisContextInput): JarvisContextPacket {
  const ranked = [...input.facts]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_RANKED_FACTS);
  const knownCount = ranked.filter((f) => f.status === 'known').length;
  const notConfiguredCount = ranked.filter((f) => f.status === 'not_configured').length;
  const lines = ranked.map((f) => `- ${f.label}: ${f.detail}${f.status !== 'known' ? ` [${f.status}]` : ''}`);
  const compactSummary = `Actor: ${input.actorName}${input.isOwner ? ' (owner)' : ''}. Scope: ${input.scope}.\n${lines.join('\n')}`;
  return { generatedAt: nowIso(), actorName: input.actorName, scope: input.scope, ranked, compactSummary, knownCount, notConfiguredCount };
}

/* ============================ response composer ============================ */

export const JarvisResponseSchema = z.object({
  reply: z.string().min(1),
  language: JarvisLanguage,
  suggestedFollowUps: z.array(z.string()).max(4).default([]),
  groundedIn: z.array(z.string()).default([]),
  /** Phase AE.1 — structured split so a caller (briefing, dashboard, quality
   *  scoring) can distinguish "what the owner said matters" from "what's
   *  technically broken" without re-parsing `reply` prose. Empty string/array
   *  when no explicit priority/blocker/next-step applies to this turn. */
  primaryPriority: z.string().default(''),
  activeBlockers: z.array(z.string()).default([]),
  nextAction: z.string().default(''),
});
export type JarvisResponse = z.infer<typeof JarvisResponseSchema>;

export interface ComposeJarvisOpts {
  text: string;
  intent: JarvisIntent;
  packet: JarvisContextPacket;
  /** For route_to_planner turns: what the real deterministic pipeline actually did/decided. */
  planSummary?: string;
  taskId?: string | null;
  forceFallback?: boolean;
}

/** Deterministic bilingual fallback composer — assembles a real, specific
 *  answer directly from the context packet. Used when no LLM key is
 *  configured or the model output fails validation. Never generic: it always
 *  quotes actual ranked facts, never invents them. */
export function composeJarvisResponseFallback(opts: ComposeJarvisOpts): JarvisResponse {
  const { intent, packet, planSummary } = opts;
  const fa = intent.language === 'fa';
  const top = packet.ranked.slice(0, 5);
  const factLine = (f: JarvisContextFact): string => `${f.label}: ${f.detail}`;

  // Phase AE.1 — an explicit, recently-stated user priority (label
  // 'user_priority', injected by the gateway from real jarvis_memory_facts —
  // see gatherJarvisFacts) always outranks generic system-health chatter and
  // canned meta self-assessment text. Only a pure system-status check is
  // exempt (the owner explicitly asked for health, not strategy) — every
  // other category leads with what the owner actually said matters right
  // now, with technical blockers and system warnings named separately so
  // they never get mistaken for the primary priority.
  const priorityFact = packet.ranked.find((f) => f.label === 'user_priority');
  if (priorityFact && intent.category !== 'system_status') {
    const blockerFacts = packet.ranked.filter((f) => (f.label === 'user_blocker' || f.label === 'open_incidents' || f.label === 'system_check') && f.detail && f.detail !== '0');
    const nextFact = packet.ranked.find((f) => f.label === 'top_next_action' || f.label === 'user_decision' || f.label === 'highest_leverage_next_step');
    const blockerLine = blockerFacts.length ? blockerFacts.map(factLine).join('؛ ') : '';
    const reply = fa
      ? `اولویت فعلی شما: ${priorityFact.detail}.${blockerLine ? ` بلاکر(های) فنی فعلی: ${blockerLine} — این‌ها جایگزین اولویت اصلی شما نیستند، فقط باید در کنارش بررسی شوند.` : ''}${nextFact ? ` قدم بعدی پیشنهادی: ${nextFact.detail}.` : ''}`
      : `Your current priority: ${priorityFact.detail}.${blockerLine ? ` Active technical blocker(s): ${blockerLine} — these don't replace your main priority, they need attention alongside it.` : ''}${nextFact ? ` Suggested next step: ${nextFact.detail}.` : ''}`;
    return JarvisResponseSchema.parse({
      reply,
      language: intent.language,
      suggestedFollowUps: fa ? ['بلاکرهای فعلی رو بررسی کنیم؟', 'الان وضعیت سیستم چیه؟'] : ['Should we tackle the blockers now?', "What's the system status now?"],
      groundedIn: ['user_priority', ...blockerFacts.map((f) => f.label), ...(nextFact ? [nextFact.label] : [])],
      primaryPriority: priorityFact.detail,
      activeBlockers: blockerFacts.map((f) => f.detail),
      nextAction: nextFact?.detail ?? '',
    });
  }

  if (intent.category === 'meta_self_assessment') {
    const reply = fa
      ? `صادقانه بگم: هسته‌ی AOS واقعی و پخته‌ست (۱۹ سرویس مستقل، حافظه و شواهد ساختاریافته)، اما تا همین اواخر لایه‌ی Jarvis صرفاً یک موتور قانون‌محورِ رجکس انگلیسی بود — بدون هیچ فراخوانی LLM، و برای فارسی عملاً کار نمی‌کرد. ${AOS_SELF_KNOWLEDGE.recentlyFixed[0]} شکاف‌های باقی‌مانده: ${AOS_SELF_KNOWLEDGE.knownGaps.slice(0, 3).join(' | ')}. قدم بعدیِ با بیشترین اثر: ${AOS_SELF_KNOWLEDGE.highestLeverageNextStep}`
      : `Honest answer: the AOS kernel underneath is real and mature (19 independent services, structured memory and evidence), but until this phase the Jarvis layer was a pure English regex command router — zero LLM calls, and it effectively didn't work in Persian. ${AOS_SELF_KNOWLEDGE.recentlyFixed[0]} Remaining gaps: ${AOS_SELF_KNOWLEDGE.knownGaps.slice(0, 3).join(' | ')}. Highest-leverage next step: ${AOS_SELF_KNOWLEDGE.highestLeverageNextStep}`;
    return JarvisResponseSchema.parse({ reply, language: intent.language, suggestedFollowUps: fa ? ['برای AOS قدم بعدی چیه؟', 'الان وضعیت سیستم من چیه؟'] : ['What is next for AOS?', "What's my system status now?"], groundedIn: ['AOS_SELF_KNOWLEDGE'] });
  }

  if (intent.category === 'system_status') {
    const body = top.map(factLine).join(' | ') || (fa ? 'داده‌ی زنده‌ای در دسترس نیست.' : 'no live data available.');
    const reply = fa ? `وضعیت الان: ${body}` : `Current status: ${body}`;
    return JarvisResponseSchema.parse({ reply, language: intent.language, suggestedFollowUps: fa ? ['کدوم تاییدها در انتظارن؟'] : ['What approvals are pending?'], groundedIn: top.map((f) => f.label) });
  }

  if (planSummary) {
    const reply = fa ? `${planSummary}` : planSummary;
    return JarvisResponseSchema.parse({ reply, language: intent.language, suggestedFollowUps: [], groundedIn: top.map((f) => f.label) });
  }

  const notConfigured = packet.ranked.filter((f) => f.status === 'not_configured').slice(0, 2);
  const reply = fa
    ? `از اطلاعات واقعیِ موجود: ${top.map(factLine).join(' | ') || 'داده‌ای برای این موضوع ثبت نشده.'}${notConfigured.length ? ` هنوز متصل نیست: ${notConfigured.map((f) => f.label).join('، ')}.` : ''}`
    : `From what's actually recorded: ${top.map(factLine).join(' | ') || 'no data recorded for this yet.'}${notConfigured.length ? ` Not yet connected: ${notConfigured.map((f) => f.label).join(', ')}.` : ''}`;
  return JarvisResponseSchema.parse({ reply, language: intent.language, suggestedFollowUps: [], groundedIn: top.map((f) => f.label) });
}

/** Phase AE.1 — correction gate. The LLM-composed reply is grounded by
 *  instruction, not by construction (unlike the fallback above), so a model
 *  can still technically ignore the packet's explicit `user_priority` fact
 *  and lean on louder system-health text instead — exactly the failure mode
 *  a real conversation exposed. Pure and cheap: true means the caller should
 *  discard the LLM reply and use `composeJarvisResponseFallback` instead,
 *  which structurally cannot skip a present `user_priority` fact. */
export function answerIgnoresStatedPriority(response: { reply: string; groundedIn: string[] }, packet: JarvisContextPacket): boolean {
  const priorityFact = packet.ranked.find((f) => f.label === 'user_priority');
  if (!priorityFact) return false;
  if (response.groundedIn.includes('user_priority')) return false;
  const snippet = priorityFact.detail.trim().slice(0, 12);
  if (snippet && response.reply.includes(snippet)) return false;
  return true;
}

/** LLM-assisted composition, strictly grounded in the supplied packet text.
 *  The fallback (schema-validated) is the safety net — never raw text escapes. */
export async function composeJarvisResponse(router: LlmRouter, opts: ComposeJarvisOpts): Promise<{ data: JarvisResponse; trace: unknown }> {
  const p = promptFor('jarvis:response');
  const langInstruction = opts.intent.language === 'fa' ? 'Reply in Persian (Farsi).' : opts.intent.language === 'en' ? 'Reply in English.' : 'Reply in the same language as the user message.';
  const prompt = [
    `User message: """${opts.text}"""`,
    `Intent category: ${opts.intent.category}`,
    `${langInstruction}`,
    `Context (the ONLY facts you may use — never invent anything outside this list):`,
    opts.packet.compactSummary,
    opts.planSummary ? `What the system actually did for this request: ${opts.planSummary}` : '',
    `Respond as JSON: {"reply":"...","language":"fa|en|other","suggestedFollowUps":["..."],"groundedIn":["label of each context fact you actually used"]}. Be concise, specific and actionable. Never claim access to data not listed above — say "not configured" instead.`,
  ].filter(Boolean).join('\n\n');
  const { data, trace } = await router.generateStructured(JarvisResponseSchema, {
    agentId: 'gateway-api',
    taskType: 'jarvis_response_composition',
    system: p.system,
    prompt,
    taskId: opts.taskId ?? null,
    fallback: () => composeJarvisResponseFallback(opts),
    promptVersion: p.version,
    forceFallback: opts.forceFallback,
  });
  return { data, trace };
}

/* ================================ turns ================================== */

export interface JarvisTurn {
  turnId: string;
  actorId: string;
  scope: 'global' | 'user';
  text: string;
  intent: JarvisIntent;
  mode: JarvisMode;
  reply: string;
  usedFallback: boolean;
  createdAt: string;
}

export function buildJarvisTurn(args: { turnId: string; actorId: string; scope: 'global' | 'user'; text: string; intent: JarvisIntent; mode: JarvisMode; reply: string; usedFallback: boolean }): JarvisTurn {
  return { ...args, createdAt: nowIso() };
}

export const JarvisTurnSchema = z.object({
  turnId: z.string(),
  actorId: z.string(),
  scope: z.enum(['global', 'user']),
  text: z.string(),
  intent: JarvisIntentSchema,
  mode: z.enum(['direct_answer', 'route_to_planner']),
  reply: z.string(),
  usedFallback: z.boolean(),
  createdAt: IsoDate,
});

// Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade
export * from './memory.js';
export * from './daily-brain.js';
export * from './quality.js';
// K2 D-177 — persistent sessions + the shared-loop turn runner
export * from './session.js';
export * from './turn-runner.js';
