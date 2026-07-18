/**
 * Personal Operating State (K2 Product Activation, D-178; mandate §4).
 *
 * NOT a new personal-data architecture. This is a thin owner-facing layer
 * over the two stores that already exist: Memory v2 (`memory_records` —
 * commitments, decisions, people, notes, deadlines, opportunities, risks,
 * preferences, with confirmed/inferred status + provenance + last-confirmed)
 * and the mission hierarchy (`mission_nodes` — goals/objectives → projects →
 * tasks). It adds:
 *   1. `buildPersonalStateSnapshot` — one owner-scoped read across both stores.
 *   2. `applyOnboardingAnswers` — a DETERMINISTIC onboarding that turns a
 *      small set of explicit owner answers into structured, provenance-tagged
 *      records. No model needed; nothing fabricated; only what the owner
 *      actually entered is stored (mandate: do not fabricate personal info).
 *
 * Everything is owner-scoped, deduped, editable and persists across sessions.
 */
import { z } from 'zod';
import {
  recordMemory, listMemories, PERSONAL_STATE_KINDS, type MemoryActor, type MemoryKind, type MemoryRecord,
} from '../memory2/index.js';
import {
  listMissionNodes, assessMissionHealth, createMissionNode, buildMissionContext,
  type MissionActor, type MissionNode,
} from '../missions/index.js';

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export interface PersonalStateSnapshot {
  generatedAt: string;
  byKind: Record<string, Array<{ memoryId: string; content: string; subject: string; status: string; lastConfirmedAt: string; pinned: boolean }>>;
  missions: MissionNode[];
  health: { overdue: number; blocked: number; stalled: number; reviewDue: number };
  counts: Record<string, number>;
  empty: boolean;
}

/** One owner-scoped read across Memory v2 (personal kinds) + missions. */
export async function buildPersonalStateSnapshot(actor: MemoryActor & MissionActor): Promise<PersonalStateSnapshot> {
  const mems = await listMemories(actor, { kinds: PERSONAL_STATE_KINDS as unknown as MemoryKind[], limit: 300 });
  const byKind: PersonalStateSnapshot['byKind'] = {};
  for (const m of mems) {
    (byKind[m.kind] ??= []).push({ memoryId: m.memoryId, content: m.content, subject: m.subject, status: m.status, lastConfirmedAt: m.lastConfirmedAt, pinned: m.pinned });
  }
  const missions = await listMissionNodes(actor, { limit: 200 });
  const health = await assessMissionHealth(actor);
  const counts: Record<string, number> = { missions: missions.length };
  for (const k of PERSONAL_STATE_KINDS) counts[k] = byKind[k]?.length ?? 0;
  const empty = mems.length === 0 && missions.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    byKind, missions,
    health: { overdue: health.overdue.length, blocked: health.blocked.length, stalled: health.stalled.length, reviewDue: health.reviewDue.length },
    counts, empty,
  };
}

/** Compact provenance-carrying context lines Jarvis reads for personal turns. */
export async function buildPersonalContext(actor: MemoryActor & MissionActor): Promise<{ text: string; lines: string[] }> {
  const snap = await buildPersonalStateSnapshot(actor);
  const lines: string[] = [];
  for (const k of PERSONAL_STATE_KINDS) {
    const rows = snap.byKind[k];
    if (rows?.length) lines.push(`${k.toUpperCase()} (${rows.length}): ${rows.slice(0, 6).map((r) => `${r.content}${r.status !== 'confirmed' ? ` [${r.status}]` : ''}`).join(' | ')}`);
  }
  const mc = await buildMissionContext(actor, { limit: 8 });
  if (mc.text) lines.push(`MISSIONS:\n${mc.text}`);
  return { text: lines.join('\n'), lines };
}

/* ------------------------------ onboarding ------------------------------- */

/** The fixed, useful onboarding questions (bilingual). Deliberately small
 *  (mandate: "a limited number of useful questions"). */
export const ONBOARDING_QUESTIONS = [
  { id: 'primary_goal', kind: 'goal' as MemoryKind, fa: 'مهم‌ترین هدف بلندمدت شما در حال حاضر چیست؟', en: 'What is your single most important long-term goal right now?' },
  { id: 'active_project', kind: 'project' as MemoryKind, fa: 'روی چه پروژه یا کار اصلی‌ای الان تمرکز دارید؟', en: 'What main project or work are you focused on now?' },
  { id: 'open_commitment', kind: 'commitment' as MemoryKind, fa: 'چه تعهد یا قولی دارید که نباید فراموش شود؟', en: 'What commitment or promise must not be forgotten?' },
  { id: 'open_decision', kind: 'decision' as MemoryKind, fa: 'چه تصمیم بازی دارید که باید بگیرید؟', en: 'What open decision do you need to make?' },
  { id: 'key_person', kind: 'person' as MemoryKind, fa: 'مهم‌ترین فردی که باید پیگیری‌اش کنید کیست و چرا؟', en: 'Who is a key person you need to follow up with, and why?' },
  { id: 'reply_language', kind: 'preference' as MemoryKind, fa: 'ترجیح می‌دهید جارویس به فارسی پاسخ دهد یا انگلیسی؟', en: 'Do you prefer Jarvis to reply in Persian or English?' },
] as const;

export type OnboardingAnswers = Record<string, string>;

/**
 * Deterministically persist explicit owner answers as confirmed, provenance-
 * tagged records. Empty answers are skipped (never fabricated). The primary
 * goal is additionally created as a mission `vision` so the hierarchy is
 * seeded from real owner intent. Idempotent per subject (re-running updates,
 * never duplicates).
 */
export async function applyOnboardingAnswers(
  actor: MemoryActor & MissionActor,
  answers: OnboardingAnswers,
  sessionId: string | null,
  publish?: Publish,
): Promise<{ created: string[]; visionId: string | null }> {
  const created: string[] = [];
  let visionId: string | null = null;
  for (const q of ONBOARDING_QUESTIONS) {
    const raw = (answers[q.id] ?? '').trim();
    if (raw.length < 2) continue;
    const subject = `onboarding:${q.id}`;
    const { memory } = await recordMemory(actor, {
      kind: q.kind, status: 'confirmed', content: raw, subject,
      importance: q.id === 'primary_goal' ? 0.95 : 0.7,
      provenance: { sourceType: 'user_stated', sessionId, turnId: null, runId: null, refIds: [], sourceUrl: '' },
    }, publish);
    created.push(memory.memoryId);
    if (q.id === 'primary_goal') {
      const { node } = await createMissionNode(actor, { nodeType: 'vision', title: raw.slice(0, 120), description: 'Seeded from onboarding.' }, publish);
      visionId = node.nodeId;
    }
  }
  return { created, visionId };
}
