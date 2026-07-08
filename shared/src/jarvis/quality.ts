/**
 * Phase AE — Jarvis Answer Quality & Task Completion Summaries.
 *
 * Two things: (1) a deterministic, evidence-style scorer that grades every
 * composed Jarvis answer against the context it was supposedly grounded in
 * (groundedness/specificity/honesty/language-match/actionability — same
 * spirit as the Phase 3 evaluation engine and Phase 7 plan scorer, but for
 * conversational answers); (2) a grounded completion-summary composer for
 * when a routed operator/Jarvis session finishes, closing the Phase AD gap
 * where completion was announced with the raw mechanical `reportSummary`.
 *
 * Structural typing on purpose: this file takes plain object shapes rather
 * than importing types from `./index.js`, so it has zero import-cycle risk
 * with the rest of the jarvis module.
 */
import { z } from 'zod';
import { genId, nowIso } from '../utils/index.js';
import type { LlmRouter } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';

/* ============================== quality score ============================== */

export interface JarvisAnswerScoreInput {
  turnId: string;
  replyText: string;
  replyLanguage: string;
  groundedIn: string[];
  suggestedFollowUpsCount: number;
  intentLanguage: string;
  intentCategory: string;
  /** Labels actually present in the context packet used to compose the reply. */
  packetLabels: string[];
  packetHasNotConfigured: boolean;
}

export const JarvisAnswerScoreSchema = z.object({
  scoreId: z.string(),
  turnId: z.string(),
  groundedness: z.number().min(0).max(1),
  specificity: z.number().min(0).max(1),
  honesty: z.number().min(0).max(1),
  languageMatch: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
  issues: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type JarvisAnswerScore = z.infer<typeof JarvisAnswerScoreSchema>;

const GENERIC_PHRASES = [
  'i heard:', 'give me a goal', 'i am an ai', 'as an ai', 'i cannot help with that', 'please try again',
];

/** Pure, deterministic — runs on the ALREADY-COMPOSED reply, so it grades LLM
 *  and fallback answers by the exact same bar. Never itself calls an LLM. */
export function scoreJarvisAnswer(input: JarvisAnswerScoreInput): JarvisAnswerScore {
  const issues: string[] = [];

  // Groundedness: fraction of claimed groundedIn labels that actually exist
  // in the packet. No claims at all on a non-trivial reply is a mild issue,
  // not a hard failure (short answers legitimately cite nothing).
  let groundedness = 1;
  if (input.groundedIn.length > 0) {
    const valid = input.groundedIn.filter((g) => input.packetLabels.includes(g));
    groundedness = valid.length / input.groundedIn.length;
    if (groundedness < 1) issues.push(`${input.groundedIn.length - valid.length} groundedIn label(s) do not exist in the context packet`);
  } else if (input.replyText.length > 60) {
    groundedness = 0.7;
    issues.push('reply cites no specific context facts');
  }

  // Specificity: length + absence of generic dead-end phrasing.
  const lower = input.replyText.toLowerCase();
  const hasGenericPhrase = GENERIC_PHRASES.some((g) => lower.includes(g));
  let specificity = input.replyText.length < 15 ? 0.3 : input.replyText.length < 40 ? 0.6 : 0.9;
  if (hasGenericPhrase) { specificity = Math.min(specificity, 0.3); issues.push('reply contains a generic/dead-end phrase'); }

  // Honesty: if the packet has not_configured facts and the reply is on a
  // category likely to touch them, the reply should say so somewhere OR cite
  // them via groundedIn. This is a soft heuristic, not a hard requirement —
  // only penalized when it's plausibly relevant.
  const mentionsNotConfigured = /not.?configured|not yet connected|not_configured|هنوز متصل نیست|not connected/i.test(input.replyText);
  const relevantCategories = new Set(['personal_life_planning', 'schedule_calendar', 'email_communication', 'finance_ops', 'research_opportunities']);
  let honesty = 1;
  if (input.packetHasNotConfigured && relevantCategories.has(input.intentCategory) && !mentionsNotConfigured && input.groundedIn.length === 0) {
    honesty = 0.6;
    issues.push('packet has not_configured items but the reply does not surface them');
  }

  // Language match: does the reply's declared language match the intent's
  // detected language (owner mixes Persian/English; 'other' always passes).
  const languageMatch = input.intentLanguage === 'other' || input.replyLanguage === input.intentLanguage ? 1 : 0.4;
  if (languageMatch < 1) issues.push(`reply language (${input.replyLanguage}) does not match detected input language (${input.intentLanguage})`);

  // Actionability: a follow-up or a clear next step keeps the conversation useful.
  const actionability = input.suggestedFollowUpsCount > 0 ? 1 : 0.6;

  const overall = Math.round(((groundedness * 0.3) + (specificity * 0.25) + (honesty * 0.2) + (languageMatch * 0.15) + (actionability * 0.1)) * 100) / 100;

  return JarvisAnswerScoreSchema.parse({
    scoreId: genId('jscore'), turnId: input.turnId, groundedness, specificity, honesty, languageMatch, actionability, overall, issues, createdAt: nowIso(),
  });
}

/* ========================= task completion summary ========================= */

const CompletionLanguage = z.enum(['fa', 'en', 'other']);
export const JarvisCompletionSummarySchema = z.object({
  reply: z.string().min(1),
  language: CompletionLanguage,
  suggestedFollowUps: z.array(z.string()).max(4).default([]),
  groundedIn: z.array(z.string()).default([]),
});
export type JarvisCompletionSummary = z.infer<typeof JarvisCompletionSummarySchema>;

export interface ComposeCompletionOpts {
  goal: string;
  status: 'completed' | 'failed' | 'cancelled';
  observations: string[];
  reportSummary: string;
  evidenceCount: number;
  language: 'fa' | 'en' | 'other';
  taskId?: string | null;
  forceFallback?: boolean;
}

/** Deterministic bilingual fallback — quotes the REAL observations/report;
 *  a failed session is always reported as failed, never softened. */
export function composeTaskCompletionFallback(opts: ComposeCompletionOpts): JarvisCompletionSummary {
  const fa = opts.language === 'fa';
  const lastObs = opts.observations[opts.observations.length - 1] ?? '';
  const body = opts.reportSummary || lastObs || (fa ? 'بدون جزئیات بیشتر.' : 'no further detail recorded.');
  const reply = opts.status === 'completed'
    ? (fa ? `انجام شد: «${opts.goal.slice(0, 80)}». ${body}${opts.evidenceCount ? ` (${opts.evidenceCount} مدرک ثبت شد)` : ''}` : `Done: “${opts.goal.slice(0, 80)}”. ${body}${opts.evidenceCount ? ` (${opts.evidenceCount} evidence record(s) stored)` : ''}`)
    : opts.status === 'failed'
      ? (fa ? `ناموفق بود: «${opts.goal.slice(0, 80)}». ${body}` : `Failed: “${opts.goal.slice(0, 80)}”. ${body}`)
      : (fa ? `لغو شد: «${opts.goal.slice(0, 80)}».` : `Cancelled: “${opts.goal.slice(0, 80)}”.`);
  return JarvisCompletionSummarySchema.parse({ reply, language: opts.language, suggestedFollowUps: [], groundedIn: ['reportSummary'] });
}

/** Item 6 — composes a grounded completion summary. Never claims success for
 *  a failed/cancelled session (enforced structurally: status is passed through
 *  verbatim to both the LLM prompt and the fallback template). */
export async function composeTaskCompletionSummary(router: LlmRouter, opts: ComposeCompletionOpts): Promise<{ data: JarvisCompletionSummary; trace: unknown }> {
  const p = promptFor('gateway-api:jarvis_completion');
  const langInstruction = opts.language === 'fa' ? 'Reply in Persian (Farsi).' : 'Reply in English.';
  const prompt = [
    `Session goal: """${opts.goal}"""`,
    `Session status: ${opts.status.toUpperCase()} — report this status honestly, never as a success if it is not.`,
    `${langInstruction}`,
    `Real observations (the ONLY source of truth — never invent steps):\n${opts.observations.slice(-8).map((o) => `- ${o}`).join('\n') || '(none recorded)'}`,
    `Report summary: ${opts.reportSummary || '(none)'}`,
    `Evidence records stored: ${opts.evidenceCount}`,
    `Respond as JSON: {"reply":"...","language":"fa|en|other","suggestedFollowUps":["..."],"groundedIn":["observation or reportSummary references used"]}.`,
  ].join('\n\n');
  const { data, trace } = await router.generateStructured(JarvisCompletionSummarySchema, {
    agentId: 'gateway-api',
    taskType: 'jarvis_task_completion_summary',
    system: p.system,
    prompt,
    taskId: opts.taskId ?? null,
    fallback: () => composeTaskCompletionFallback(opts),
    promptVersion: p.version,
    forceFallback: opts.forceFallback,
  });
  return { data, trace };
}
