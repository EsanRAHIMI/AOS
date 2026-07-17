/**
 * Persistent Jarvis Sessions (K2, D-177; mandate §C, jarvis-spec G.2).
 *
 * Jarvis is a persistent operating interface, not a request/response box:
 * sessions survive reloads and restarts, keep the full transcript, maintain
 * a rolling summary + pinned facts + active mission threads, and support
 * multiple parallel threads per owner. Every turn runs on the ONE shared
 * agent loop; this module owns the durable session state around it.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';
import { detectLanguage } from './index.js';
import { approxTokens } from '../memory2/index.js';

export const JarvisSessionSchema = z.object({
  sessionId: z.string(),
  title: z.string().default(''),
  status: z.enum(['active', 'archived']).default('active'),
  /** Rolling summary — regenerated as the transcript grows past budget. */
  rollingSummary: z.string().default(''),
  /** Owner-pinned facts always present in context. */
  pinnedFacts: z.array(z.string()).default([]),
  /** Linked mission/thread context (mission_nodes ids). */
  activeMissionIds: z.array(z.string()).default([]),
  turnCount: z.number().int().default(0),
  lastLanguage: z.enum(['fa', 'en', 'other']).default('other'),
  lastTurnAt: z.string().nullable().default(null),
  totalCostUsd: z.number().default(0),
  createdAt: IsoDate,
  updatedAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type JarvisSession = z.infer<typeof JarvisSessionSchema>;

export const JarvisSessionTurnSchema = z.object({
  turnId: z.string(),
  sessionId: z.string(),
  index: z.number().int(),
  userText: z.string(),
  /** 'text' | 'voice' — both transports land in the SAME session/loop. */
  inputTransport: z.enum(['text', 'voice']).default('text'),
  language: z.enum(['fa', 'en', 'other']).default('other'),
  runId: z.string().nullable().default(null),
  replyText: z.string().default(''),
  status: z.enum(['running', 'waiting_approval', 'completed', 'failed', 'cancelled']).default('running'),
  stopReason: z.string().default(''),
  reasoningMode: z.enum(['native', 'structured', 'none']).default('none'),
  provider: z.string().default(''),
  model: z.string().default(''),
  costUsd: z.number().default(0),
  usedMemoryIds: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  pendingApprovalId: z.string().nullable().default(null),
  createdAt: IsoDate,
  finishedAt: z.string().nullable().default(null),
}).merge(ScopeFieldsSchema);
export type JarvisSessionTurn = z.infer<typeof JarvisSessionTurnSchema>;

const sessions = () => collection<JarvisSession>(COLLECTIONS.JARVIS_SESSIONS);
const turns = () => collection<JarvisSessionTurn>(COLLECTIONS.JARVIS_SESSION_TURNS);

export interface SessionActor {
  actorId: string;
  scope: 'global' | 'user';
  tenantId?: string | null;
}

function scopeFilter(actor: SessionActor): Record<string, unknown> {
  if (actor.scope === 'user') return { scope: 'user', createdBy: actor.actorId };
  return { scope: 'global' };
}

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export async function createJarvisSession(actor: SessionActor, args: { title?: string } = {}, publish?: Publish): Promise<JarvisSession> {
  const now = nowIso();
  const session = JarvisSessionSchema.parse({
    sessionId: genId('jsess'),
    title: args.title ?? '',
    createdAt: now,
    updatedAt: now,
    scope: actor.scope,
    ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    createdBy: actor.actorId,
    visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await sessions().insertOne(session);
  await publish?.({ type: EVENT_TYPES.JARVIS_SESSION_STARTED, taskId: null, payload: { sessionId: session.sessionId, message: 'Jarvis session started' } });
  return session;
}

export async function getJarvisSession(actor: SessionActor, sessionId: string): Promise<JarvisSession | null> {
  return sessions().findOne({ ...scopeFilter(actor), sessionId } as never, { projection: { _id: 0 } as never });
}

export async function listJarvisSessions(actor: SessionActor, opts: { limit?: number; includeArchived?: boolean } = {}): Promise<JarvisSession[]> {
  const filter: Record<string, unknown> = { ...scopeFilter(actor) };
  if (!opts.includeArchived) filter.status = 'active';
  return sessions().find(filter as never, { projection: { _id: 0 } as never }).sort({ updatedAt: -1 }).limit(opts.limit ?? 30).toArray();
}

export async function listSessionTurns(actor: SessionActor, sessionId: string, opts: { limit?: number } = {}): Promise<JarvisSessionTurn[]> {
  return turns().find({ ...scopeFilter(actor), sessionId } as never, { projection: { _id: 0 } as never }).sort({ index: 1 }).limit(opts.limit ?? 200).toArray();
}

export async function beginTurn(actor: SessionActor, sessionId: string, userText: string, transport: 'text' | 'voice' = 'text'): Promise<JarvisSessionTurn> {
  const session = await getJarvisSession(actor, sessionId);
  if (!session) throw new Error(`session ${sessionId} not found in scope`);
  const now = nowIso();
  const turn = JarvisSessionTurnSchema.parse({
    turnId: genId('jturn'),
    sessionId,
    index: session.turnCount,
    userText,
    inputTransport: transport,
    language: detectLanguage(userText),
    createdAt: now,
    scope: actor.scope,
    ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    createdBy: actor.actorId,
    visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await turns().insertOne(turn);
  await sessions().updateOne({ sessionId }, {
    $set: {
      updatedAt: now,
      lastTurnAt: now,
      lastLanguage: turn.language,
      ...(session.title ? {} : { title: userText.slice(0, 80) }),
    },
    $inc: { turnCount: 1 },
  });
  return turn;
}

export async function completeTurn(turnId: string, patch: Partial<Pick<JarvisSessionTurn, 'replyText' | 'status' | 'stopReason' | 'runId' | 'reasoningMode' | 'provider' | 'model' | 'costUsd' | 'usedMemoryIds' | 'sourceIds' | 'pendingApprovalId'>>): Promise<void> {
  const terminal = patch.status && patch.status !== 'running' && patch.status !== 'waiting_approval';
  await turns().updateOne({ turnId }, { $set: { ...patch, ...(terminal ? { finishedAt: nowIso() } : {}) } });
  if (patch.costUsd) {
    const t = await turns().findOne({ turnId });
    if (t) await sessions().updateOne({ sessionId: t.sessionId }, { $inc: { totalCostUsd: patch.costUsd }, $set: { updatedAt: nowIso() } });
  }
}

export async function pinFactToSession(actor: SessionActor, sessionId: string, fact: string): Promise<boolean> {
  const res = await sessions().updateOne({ ...scopeFilter(actor), sessionId } as never, { $addToSet: { pinnedFacts: fact.slice(0, 300) }, $set: { updatedAt: nowIso() } } as never);
  return (res as { modifiedCount?: number }).modifiedCount === 1;
}

export async function linkMissionToSession(actor: SessionActor, sessionId: string, missionNodeId: string): Promise<boolean> {
  const res = await sessions().updateOne({ ...scopeFilter(actor), sessionId } as never, { $addToSet: { activeMissionIds: missionNodeId }, $set: { updatedAt: nowIso() } } as never);
  return (res as { modifiedCount?: number }).modifiedCount === 1;
}

/**
 * Transcript context under a token budget: rolling summary (when present) +
 * as many recent turns as fit. When the un-summarized tail grows past the
 * budget, fold older turns into the rolling summary (deterministic
 * compaction — an LLM summarizer can replace this text later without schema
 * change; honesty: this is compaction, not intelligence).
 */
export async function buildTranscriptContext(actor: SessionActor, sessionId: string, opts: { tokenBudget?: number } = {}): Promise<{ text: string; usedTurns: number }> {
  const budget = opts.tokenBudget ?? 1200;
  const session = await getJarvisSession(actor, sessionId);
  if (!session) return { text: '', usedTurns: 0 };
  const all = await turns().find({ ...scopeFilter(actor), sessionId } as never).sort({ index: -1 }).limit(40).toArray();
  const lines: string[] = [];
  let tokens = session.rollingSummary ? approxTokens(session.rollingSummary) : 0;
  let used = 0;
  for (const t of all) { // newest first
    const line = `${t.language === 'fa' ? 'Owner' : 'Owner'}: ${t.userText.slice(0, 400)}\nJarvis: ${t.replyText.slice(0, 400)}`;
    const cost = approxTokens(line);
    if (tokens + cost > budget) break;
    tokens += cost;
    lines.unshift(line);
    used += 1;
  }
  const parts: string[] = [];
  if (session.rollingSummary) parts.push(`EARLIER IN THIS SESSION (summary): ${session.rollingSummary}`);
  if (session.pinnedFacts.length) parts.push(`PINNED FACTS:\n${session.pinnedFacts.map((f) => `- ${f}`).join('\n')}`);
  if (lines.length) parts.push(`RECENT CONVERSATION:\n${lines.join('\n')}`);
  return { text: parts.join('\n\n'), usedTurns: used };
}

/** Fold turns older than the retained tail into the rolling summary. */
export async function compactSession(actor: SessionActor, sessionId: string, opts: { keepRecentTurns?: number } = {}): Promise<{ folded: number }> {
  const keep = opts.keepRecentTurns ?? 12;
  const session = await getJarvisSession(actor, sessionId);
  if (!session) return { folded: 0 };
  const all = await turns().find({ ...scopeFilter(actor), sessionId } as never).sort({ index: 1 }).toArray();
  if (all.length <= keep) return { folded: 0 };
  const toFold = all.slice(0, all.length - keep);
  const bullet = (t: JarvisSessionTurn): string => `[t${t.index}] ${t.userText.slice(0, 120)} → ${t.replyText.slice(0, 120)}`;
  const folded = `${session.rollingSummary ? `${session.rollingSummary}\n` : ''}${toFold.map(bullet).join('\n')}`.slice(-4000);
  await sessions().updateOne({ sessionId }, { $set: { rollingSummary: folded, updatedAt: nowIso() } });
  return { folded: toFold.length };
}
