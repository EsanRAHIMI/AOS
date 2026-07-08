/**
 * Phase AE — Jarvis Daily Brain.
 *
 * A richer context packet than Phase AD's request-scoped one: instead of
 * "what does THIS message need", the daily brain asks "what does the owner
 * need to know about their whole current reality right now" — active
 * tasks/projects ranked by priority, recent decisions, active blockers/risks,
 * and a composed narrative briefing.
 *
 * Pure module: the gateway fetches real records (tasks, personal projects,
 * decision memories, incidents, personal risks, next-best-actions, extracted
 * Jarvis memory facts) and passes them in. Nothing here is invented or
 * fetched — same discipline as `./index.js` and `../personal/index.js`.
 * No dependency on `./index.js` (kept import-cycle-free by design).
 */
import { z } from 'zod';
import { nowIso } from '../utils/index.js';
import type { LlmRouter } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';

/* ================================ inputs ================================= */

export interface DailyBrainTaskInput { taskId: string; goal: string; status: string; priority: string; createdAt: string }
export interface DailyBrainProjectInput { projectId: string; title: string; incomePotential: string; status: string }
export interface DailyBrainDecisionInput { decisionId: string; goal: string; selectedReason: string; createdAt: string }
export interface DailyBrainIncidentInput { incidentId: string; title: string; severity: string }
export interface DailyBrainRiskInput { riskId: string; title: string; severity: string; mitigation: string }
export interface DailyBrainActionInput { title: string; reason: string; priorityScore: number }
export interface DailyBrainMemoryFactInput { kind: string; content: string; createdAt: string }

export interface DailyBrainInput {
  actorName: string;
  scope: 'global' | 'user';
  activeTasks: DailyBrainTaskInput[];
  activeProjects: DailyBrainProjectInput[];
  pendingApprovals: number;
  openIncidents: DailyBrainIncidentInput[];
  personalRisks: DailyBrainRiskInput[];
  recentDecisions: DailyBrainDecisionInput[];
  recentMemoryFacts: DailyBrainMemoryFactInput[];
  nextBestActions: DailyBrainActionInput[];
  safeMode: boolean;
}

/* ============================ priority ranking ============================ */

export interface PrioritizedItem { label: string; detail: string; type: 'task' | 'project' | 'action'; weight: number }

const TASK_PRIORITY_WEIGHT: Record<string, number> = { critical: 10, high: 7, normal: 4, low: 2 };
const TASK_STATUS_BOOST: Record<string, number> = { blocked: 3, awaiting_approval: 2, in_progress: 1 };
const PROJECT_INCOME_WEIGHT: Record<string, number> = { high: 6, medium: 4, low: 2, none: 1, unknown: 1 };

/** Deterministic: same input ⇒ same ranking. Combines active kernel tasks,
 *  active personal projects and already-ranked next-best-actions into ONE
 *  prioritized list (item 3 — "task/project priority extraction"). */
export function rankPriorities(input: DailyBrainInput): PrioritizedItem[] {
  const items: PrioritizedItem[] = [];
  for (const t of input.activeTasks) {
    const base = TASK_PRIORITY_WEIGHT[t.priority] ?? 4;
    const boost = TASK_STATUS_BOOST[t.status] ?? 0;
    items.push({ label: t.goal.slice(0, 80), detail: `task · ${t.status} · ${t.priority} priority`, type: 'task', weight: base + boost });
  }
  for (const p of input.activeProjects) {
    if (p.status !== 'active') continue;
    items.push({ label: p.title.slice(0, 80), detail: `project · income potential ${p.incomePotential}`, type: 'project', weight: PROJECT_INCOME_WEIGHT[p.incomePotential] ?? 1 });
  }
  for (const a of input.nextBestActions) {
    items.push({ label: a.title.slice(0, 80), detail: a.reason.slice(0, 120), type: 'action', weight: a.priorityScore });
  }
  return items.sort((a, b) => b.weight - a.weight).slice(0, 12);
}

/* ===================== decisions and blockers summary ===================== */

/** Item 4 — recent decisions + active blockers, from real records only. */
export function summarizeDecisionsAndBlockers(input: DailyBrainInput): { decisions: string[]; blockers: string[] } {
  const decisions = [
    ...input.recentDecisions.slice(0, 5).map((d) => `${d.goal.slice(0, 80)}: ${d.selectedReason.slice(0, 100)}`),
    ...input.recentMemoryFacts.filter((f) => f.kind === 'decision').slice(0, 3).map((f) => f.content),
  ].slice(0, 6);
  const blockers = [
    ...input.openIncidents.filter((i) => i.severity === 'high' || i.severity === 'critical').map((i) => `${i.title} (incident, ${i.severity})`),
    ...input.personalRisks.filter((r) => r.severity === 'high' || r.severity === 'critical').map((r) => `${r.title} (risk, ${r.severity}${r.mitigation ? ` — mitigation: ${r.mitigation}` : ' — no mitigation recorded'})`),
    ...input.recentMemoryFacts.filter((f) => f.kind === 'blocker').map((f) => f.content),
  ].slice(0, 8);
  return { decisions, blockers };
}

/* ============================ daily brain packet =========================== */

export interface DailyBrainPacket {
  generatedAt: string;
  actorName: string;
  scope: 'global' | 'user';
  prioritizedItems: PrioritizedItem[];
  decisions: string[];
  blockers: string[];
  pendingApprovals: number;
  safeMode: boolean;
  compactSummary: string;
}

/** Item 2 — the real daily-brain context packet. Pure, deterministic. */
export function buildDailyBrainPacket(input: DailyBrainInput): DailyBrainPacket {
  const prioritizedItems = rankPriorities(input);
  const { decisions, blockers } = summarizeDecisionsAndBlockers(input);
  const lines = [
    `Actor: ${input.actorName}. Scope: ${input.scope}. Safe mode: ${input.safeMode ? 'ON' : 'off'}. Approvals pending: ${input.pendingApprovals}.`,
    prioritizedItems.length
      ? `Top priorities:\n${prioritizedItems.slice(0, 8).map((p, i) => `${i + 1}. [${p.type}] ${p.label} — ${p.detail}`).join('\n')}`
      : 'No prioritized tasks/projects/actions recorded right now.',
    decisions.length ? `Recent decisions:\n${decisions.map((d) => `- ${d}`).join('\n')}` : 'No recent decisions recorded.',
    blockers.length ? `Active blockers:\n${blockers.map((b) => `- ${b}`).join('\n')}` : 'No active blockers recorded.',
  ];
  return {
    generatedAt: nowIso(), actorName: input.actorName, scope: input.scope, prioritizedItems, decisions, blockers,
    pendingApprovals: input.pendingApprovals, safeMode: input.safeMode, compactSummary: lines.join('\n\n'),
  };
}

/* ============================ briefing composer ============================ */

const BriefingLanguage = z.enum(['fa', 'en', 'other']);
export const JarvisBriefingSchema = z.object({
  headline: z.string().min(1),
  narrative: z.string().min(1),
  topPriorities: z.array(z.string()).max(6).default([]),
  decisions: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  suggestedFollowUps: z.array(z.string()).max(4).default([]),
  language: BriefingLanguage,
});
export type JarvisBriefing = z.infer<typeof JarvisBriefingSchema>;

export interface ComposeDailyBriefingOpts {
  packet: DailyBrainPacket;
  language: 'fa' | 'en' | 'other';
  taskId?: string | null;
  forceFallback?: boolean;
}

/** Deterministic bilingual fallback — built directly from the packet, never
 *  generic. Used when no LLM key is configured or output fails validation. */
export function composeDailyBriefingFallback(opts: ComposeDailyBriefingOpts): JarvisBriefing {
  const { packet } = opts;
  const fa = opts.language === 'fa';
  const top = packet.prioritizedItems.slice(0, 3).map((p) => p.label);
  const headline = fa
    ? `بریفینگ روزانه — ${packet.pendingApprovals} تایید در انتظار، ${packet.blockers.length} مانع فعال.`
    : `Daily briefing — ${packet.pendingApprovals} approval(s) pending, ${packet.blockers.length} active blocker(s).`;
  const narrative = fa
    ? `${top.length ? `اولویت‌های اصلی: ${top.join('، ')}.` : 'هیچ اولویتِ رتبه‌بندی‌شده‌ای ثبت نشده.'} ${packet.blockers.length ? `موانع: ${packet.blockers.slice(0, 2).join(' | ')}.` : 'مانعی ثبت نشده.'} ${packet.decisions.length ? `آخرین تصمیم: ${packet.decisions[0]}.` : ''}`.trim()
    : `${top.length ? `Top priorities: ${top.join(', ')}.` : 'No ranked priorities recorded.'} ${packet.blockers.length ? `Blockers: ${packet.blockers.slice(0, 2).join(' | ')}.` : 'No blockers recorded.'} ${packet.decisions.length ? `Latest decision: ${packet.decisions[0]}.` : ''}`.trim();
  return JarvisBriefingSchema.parse({
    headline, narrative, topPriorities: top, decisions: packet.decisions.slice(0, 3), blockers: packet.blockers.slice(0, 3),
    suggestedFollowUps: fa ? ['الان وضعیت سیستم من چیه؟', 'امروز مهم‌ترین کاری که باید انجام بدم چیه؟'] : ["What's my system status now?", 'What should I focus on today?'],
    language: opts.language,
  });
}

/** Item 7 support — LLM-assisted narrative, strictly grounded in the packet. */
export async function composeDailyBriefing(router: LlmRouter, opts: ComposeDailyBriefingOpts): Promise<{ data: JarvisBriefing; trace: unknown }> {
  const p = promptFor('gateway-api:jarvis_briefing');
  const langInstruction = opts.language === 'fa' ? 'Reply in Persian (Farsi).' : opts.language === 'en' ? 'Reply in English.' : 'Reply in English.';
  const prompt = [
    `${langInstruction}`,
    `Context (the ONLY facts you may use — never invent tasks, projects, decisions or blockers not listed):`,
    opts.packet.compactSummary,
    `Respond as JSON: {"headline":"...","narrative":"...","topPriorities":["..."],"decisions":["..."],"blockers":["..."],"suggestedFollowUps":["..."],"language":"fa|en|other"}.`,
  ].join('\n\n');
  const { data, trace } = await router.generateStructured(JarvisBriefingSchema, {
    agentId: 'gateway-api',
    taskType: 'jarvis_daily_briefing',
    system: p.system,
    prompt,
    taskId: opts.taskId ?? null,
    fallback: () => composeDailyBriefingFallback(opts),
    promptVersion: p.version,
    forceFallback: opts.forceFallback,
  });
  return { data, trace };
}
