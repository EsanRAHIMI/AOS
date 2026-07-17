/**
 * Memory v2 (K2, D-177; mandate §F) — memory that changes later answers.
 *
 * Layers: confirmed structured facts / preferences / commitments / decisions,
 * inferred information, temporary conversation context, research knowledge,
 * reflection lessons and reusable skills — all as ONE scoped collection with
 * kind + status + provenance, so retrieval, correction, contradiction
 * handling and deletion behave uniformly.
 *
 * Retrieval is HYBRID: bilingual (FA/EN) lexical scoring always works with
 * zero external dependencies (the offline mandate); vector similarity is
 * blended in only when a LOCAL embedding provider (Ollama / any
 * OpenAI-compatible endpoint) is configured. No paid hosted vector service —
 * vectors live in Mongo next to everything else.
 *
 * A stored record alone is not memory: `buildMemoryContext` is what Jarvis
 * actually reads each turn — scope-filtered, relevance-ranked,
 * token-budgeted, provenance-carrying. Cross-session recall is proven by
 * contract test + the runtime scenario, not claimed.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS, EVENT_TYPES } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';

/* -------------------------------- schema -------------------------------- */

export const MemoryKind = z.enum([
  'fact', 'preference', 'commitment', 'decision', 'goal', 'person', 'project',
  'research', 'lesson', 'skill', 'context',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** confirmed = owner said/approved it; inferred = model concluded it;
 *  temporary = conversation-local context that decays fast. */
export const MemoryStatus = z.enum(['confirmed', 'inferred', 'temporary']);
export type MemoryStatus = z.infer<typeof MemoryStatus>;

export const MemoryProvenanceSchema = z.object({
  sourceType: z.enum(['user_stated', 'user_corrected', 'jarvis_inferred', 'research', 'reflection', 'system']),
  sessionId: z.string().nullable().default(null),
  turnId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  refIds: z.array(z.string()).default([]),
  sourceUrl: z.string().default(''),
});
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

export const MemoryRecordSchema = z.object({
  memoryId: z.string(),
  kind: MemoryKind,
  status: MemoryStatus,
  /** Compact natural-language content — what Jarvis reads. */
  content: z.string().min(1),
  /** Dedup / contradiction key, e.g. 'preference:reply_language' or a person name. */
  subject: z.string().default(''),
  language: z.enum(['fa', 'en', 'other']).default('other'),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.7),
  pinned: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  provenance: MemoryProvenanceSchema,
  lastConfirmedAt: IsoDate,
  /** Contradiction chain: a newer record that replaces this one. */
  supersededBy: z.string().nullable().default(null),
  deletedAt: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export interface MemoryActor {
  actorId: string;
  scope: 'global' | 'user';
  userId?: string | null;
  tenantId?: string | null;
}

const records = () => collection<MemoryRecord>(COLLECTIONS.MEMORY_RECORDS);

interface EmbeddingRow {
  memoryId: string;
  vector: number[];
  model: string;
  createdAt: string;
  createdBy: string;
}
const embeddings = () => collection<EmbeddingRow>(COLLECTIONS.MEMORY_EMBEDDINGS);

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

/* ------------------------- bilingual lexical core ------------------------ */

/** Normalize FA/EN text into comparable tokens. Persian: unify ی/ي, ک/ك,
 *  strip diacritics + tatweel, split ZWNJ. English: lowercase, strip
 *  punctuation. Numbers kept. */
export function tokenize(text: string): string[] {
  const normalized = text
    .replace(/[ي]/g, 'ی') // ي → ی
    .replace(/[ك]/g, 'ک') // ك → ک
    .replace(/[ً-ٰٟـ]/g, '') // diacritics + tatweel
    .replace(/‌/g, ' ') // ZWNJ → space
    .toLowerCase();
  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

const FA_STOP = new Set(['که', 'از', 'به', 'با', 'در', 'را', 'این', 'آن', 'های', 'برای', 'است', 'شده', 'کن', 'کند', 'شود', 'یک', 'من', 'تو', 'او', 'ما', 'هم', 'یا', 'اگر', 'تا']);
const EN_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'be', 'my', 'me', 'it', 'this', 'that', 'with', 'do', 'you', 'i']);

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !FA_STOP.has(t) && !EN_STOP.has(t));
}

/** Lexical relevance: weighted term overlap. Rarer overlap terms (within the
 *  candidate set) count more — a cheap, dependency-free BM25 spirit. */
export function lexicalScores(query: string, candidates: MemoryRecord[]): Map<string, number> {
  const qTokens = new Set(contentTokens(query));
  const docFreq = new Map<string, number>();
  const docTokens = new Map<string, Set<string>>();
  for (const c of candidates) {
    const toks = new Set(contentTokens(`${c.subject} ${c.content} ${c.tags.join(' ')}`));
    docTokens.set(c.memoryId, toks);
    for (const t of toks) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const n = Math.max(candidates.length, 1);
  const out = new Map<string, number>();
  for (const c of candidates) {
    const toks = docTokens.get(c.memoryId) ?? new Set<string>();
    let score = 0;
    for (const t of qTokens) {
      if (toks.has(t)) score += Math.log(1 + n / (docFreq.get(t) ?? 1));
    }
    out.set(c.memoryId, qTokens.size ? score / Math.sqrt(qTokens.size) : 0);
  }
  return out;
}

/* --------------------------- embedding provider -------------------------- */

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Ollama-native or any OpenAI-compatible /embeddings endpoint — both are
 *  self-hostable. Returns null when nothing is configured (lexical-only). */
export function embeddingProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const base = env.EMBEDDINGS_BASE_URL || env.LLM_LOCAL_BASE_URL || '';
  if (!base) return null;
  const model = env.EMBEDDINGS_MODEL || 'nomic-embed-text';
  const apiKey = env.EMBEDDINGS_API_KEY || env.LLM_LOCAL_API_KEY || 'local';
  const url = `${base.replace(/\/$/, '')}/embeddings`;
  return {
    name: 'openai-compatible-embeddings',
    model,
    async embed(texts: string[]): Promise<number[][]> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`embeddings ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      return (body.data ?? []).map((d) => d.embedding ?? []);
    },
  };
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { const x = a[i] ?? 0; const y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** Background/batch indexing: embed records that don't have vectors yet. */
export async function embedPendingMemories(provider: EmbeddingProvider, actor: MemoryActor, batchSize = 32): Promise<number> {
  const filter = scopeFilter(actor);
  const all = await records().find({ ...filter, deletedAt: null } as never).sort({ updatedAt: -1 }).limit(500).toArray();
  const have = new Set((await embeddings().find({ memoryId: { $in: all.map((r) => r.memoryId) } } as never).toArray()).map((e) => e.memoryId));
  const pending = all.filter((r) => !have.has(r.memoryId)).slice(0, batchSize);
  if (!pending.length) return 0;
  const vectors = await provider.embed(pending.map((r) => `${r.subject} ${r.content}`));
  for (let i = 0; i < pending.length; i += 1) {
    const rec = pending[i];
    const vec = vectors[i];
    if (rec && vec?.length) {
      await embeddings().insertOne({ memoryId: rec.memoryId, vector: vec, model: provider.model, createdAt: nowIso(), createdBy: actor.actorId });
    }
  }
  return pending.length;
}

/* ------------------------------- operations ------------------------------ */

function scopeFilter(actor: MemoryActor): Record<string, unknown> {
  // User-scoped memories are private to that user; global scope sees global records.
  if (actor.scope === 'user') return { scope: 'user', createdBy: actor.actorId };
  return { scope: 'global' };
}

export interface RecordMemoryArgs {
  kind: MemoryKind;
  status: MemoryStatus;
  content: string;
  subject?: string;
  language?: 'fa' | 'en' | 'other';
  importance?: number;
  confidence?: number;
  tags?: string[];
  provenance: MemoryProvenance;
  pinned?: boolean;
}

/**
 * Record with consolidation: an (almost) identical active record on the same
 * subject is refreshed (lastConfirmedAt, status upgrade) instead of
 * duplicated. A DIFFERENT active record on the same subject is a
 * contradiction: when the new record is confirmed (or corrects), the old one
 * is superseded — never silently kept as a live duplicate truth.
 */
export async function recordMemory(actor: MemoryActor, args: RecordMemoryArgs, publish?: Publish): Promise<{ memory: MemoryRecord; action: 'created' | 'refreshed' | 'superseded_previous' }> {
  const now = nowIso();
  const filter = scopeFilter(actor);
  let action: 'created' | 'refreshed' | 'superseded_previous' = 'created';

  if (args.subject) {
    const existing = await records().findOne({ ...filter, subject: args.subject, deletedAt: null, supersededBy: null } as never);
    if (existing) {
      const same = contentTokens(existing.content).join(' ') === contentTokens(args.content).join(' ');
      if (same) {
        const upgraded = existing.status === 'confirmed' || args.status !== 'confirmed' ? existing.status : args.status;
        await records().updateOne({ memoryId: existing.memoryId }, { $set: { lastConfirmedAt: now, updatedAt: now, status: upgraded, importance: Math.max(existing.importance, args.importance ?? 0.5) } });
        const memory = (await records().findOne({ memoryId: existing.memoryId })) as MemoryRecord;
        return { memory, action: 'refreshed' };
      }
      const newWins = args.status === 'confirmed' || args.provenance.sourceType === 'user_corrected' || existing.status !== 'confirmed';
      if (newWins) {
        action = 'superseded_previous';
        // supersededBy is set below once the new id exists.
      } else {
        // Existing confirmed fact beats a new inference — record the new one
        // as inferred-but-superseded so the contradiction is inspectable.
        const inferior: MemoryRecord = MemoryRecordSchema.parse({
          memoryId: genId('mem'), kind: args.kind, status: args.status, content: args.content, subject: args.subject ?? '',
          language: args.language ?? 'other', importance: args.importance ?? 0.5, confidence: args.confidence ?? 0.5,
          pinned: false, tags: args.tags ?? [], provenance: args.provenance, lastConfirmedAt: now,
          supersededBy: existing.memoryId, deletedAt: null, createdAt: now, updatedAt: now,
          scope: actor.scope, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}), createdBy: actor.actorId,
          visibility: actor.scope === 'user' ? 'private' : 'public',
        });
        await records().insertOne(inferior);
        return { memory: existing, action: 'refreshed' };
      }
    }
  }

  const memory: MemoryRecord = MemoryRecordSchema.parse({
    memoryId: genId('mem'), kind: args.kind, status: args.status, content: args.content, subject: args.subject ?? '',
    language: args.language ?? 'other', importance: args.importance ?? 0.5, confidence: args.confidence ?? 0.7,
    pinned: args.pinned ?? false, tags: args.tags ?? [], provenance: args.provenance, lastConfirmedAt: now,
    supersededBy: null, deletedAt: null, createdAt: now, updatedAt: now,
    scope: actor.scope, ...(actor.tenantId ? { tenantId: actor.tenantId } : {}), createdBy: actor.actorId,
    visibility: actor.scope === 'user' ? 'private' : 'public',
  });
  await records().insertOne(memory);
  if (action === 'superseded_previous' && args.subject) {
    await records().updateMany(
      { ...scopeFilter(actor), subject: args.subject, deletedAt: null, supersededBy: null, memoryId: { $ne: memory.memoryId } } as never,
      { $set: { supersededBy: memory.memoryId, updatedAt: now } } as never,
    );
  }
  await publish?.({ type: EVENT_TYPES.MEMORY_RECORDED, taskId: null, payload: { memoryId: memory.memoryId, kind: memory.kind, status: memory.status, subject: memory.subject, message: `Memory recorded (${memory.kind}/${memory.status})` } });
  return { memory, action };
}

/** Owner correction: replaces content, marks confirmed, supersedes nothing —
 *  it IS the same record, corrected, with provenance updated. */
export async function correctMemory(actor: MemoryActor, memoryId: string, newContent: string, publish?: Publish): Promise<MemoryRecord | null> {
  const now = nowIso();
  const res = await records().findOneAndUpdate(
    { ...scopeFilter(actor), memoryId, deletedAt: null } as never,
    { $set: { content: newContent, status: 'confirmed', confidence: 1, lastConfirmedAt: now, updatedAt: now, 'provenance.sourceType': 'user_corrected' } } as never,
    { returnDocument: 'after' },
  );
  if (res) {
    await embeddings().deleteMany({ memoryId } as never); // stale vector must not survive a correction
    await publish?.({ type: EVENT_TYPES.MEMORY_CORRECTED, taskId: null, payload: { memoryId, message: 'Memory corrected by owner' } });
  }
  return res ?? null;
}

export async function pinMemory(actor: MemoryActor, memoryId: string, pinned: boolean): Promise<boolean> {
  const res = await records().updateOne({ ...scopeFilter(actor), memoryId, deletedAt: null } as never, { $set: { pinned, updatedAt: nowIso() } });
  return (res as { modifiedCount?: number }).modifiedCount === 1;
}

/** Tombstone + deletion propagation (embeddings removed immediately). */
export async function deleteMemory(actor: MemoryActor, memoryId: string, publish?: Publish): Promise<boolean> {
  const now = nowIso();
  const res = await records().updateOne({ ...scopeFilter(actor), memoryId, deletedAt: null } as never, { $set: { deletedAt: now, updatedAt: now } });
  const ok = (res as { modifiedCount?: number }).modifiedCount === 1;
  if (ok) {
    await embeddings().deleteMany({ memoryId } as never);
    await publish?.({ type: EVENT_TYPES.MEMORY_DELETED, taskId: null, payload: { memoryId, message: 'Memory deleted' } });
  }
  return ok;
}

/** Stale-fact decay: temporary memories expire; unconfirmed inferences lose
 *  importance over time. Run from the consolidation watch. */
export async function decayStaleMemories(actor: MemoryActor, opts: { temporaryTtlHours?: number; inferredHalfLifeDays?: number } = {}): Promise<{ expiredTemporary: number; decayedInferred: number }> {
  const now = Date.now();
  const ttlMs = (opts.temporaryTtlHours ?? 48) * 3600_000;
  const filter = scopeFilter(actor);
  const tmp = await records().updateMany(
    { ...filter, status: 'temporary', deletedAt: null, lastConfirmedAt: { $lt: new Date(now - ttlMs).toISOString() } } as never,
    { $set: { deletedAt: nowIso(), updatedAt: nowIso() } } as never,
  );
  const halfLifeDays = opts.inferredHalfLifeDays ?? 30;
  const inferred = await records().find({ ...filter, status: 'inferred', deletedAt: null, supersededBy: null } as never).toArray();
  let decayed = 0;
  for (const r of inferred) {
    const ageDays = (now - Date.parse(r.lastConfirmedAt)) / 86_400_000;
    const factor = Math.pow(0.5, ageDays / halfLifeDays);
    const next = Math.max(0.05, Math.round(r.importance * factor * 100) / 100);
    if (next < r.importance) {
      await records().updateOne({ memoryId: r.memoryId }, { $set: { importance: next, updatedAt: nowIso() } });
      decayed += 1;
    }
  }
  return { expiredTemporary: (tmp as { modifiedCount?: number }).modifiedCount ?? 0, decayedInferred: decayed };
}

/* -------------------------------- retrieval ------------------------------ */

export interface MemorySearchOpts {
  limit?: number;
  kinds?: MemoryKind[];
  includeSuperseded?: boolean;
  queryVector?: number[] | null;
}

export interface ScoredMemory {
  record: MemoryRecord;
  score: number;
  lexical: number;
  vector: number;
}

export async function searchMemories(actor: MemoryActor, query: string, opts: MemorySearchOpts = {}): Promise<ScoredMemory[]> {
  const filter: Record<string, unknown> = { ...scopeFilter(actor), deletedAt: null };
  if (!opts.includeSuperseded) filter.supersededBy = null;
  if (opts.kinds?.length) filter.kind = { $in: opts.kinds };
  const candidates = await records().find(filter as never).sort({ updatedAt: -1 }).limit(400).toArray();
  const lex = lexicalScores(query, candidates);

  let vecScores = new Map<string, number>();
  if (opts.queryVector?.length) {
    const rows = await embeddings().find({ memoryId: { $in: candidates.map((c) => c.memoryId) } } as never).toArray();
    vecScores = new Map(rows.map((r) => [r.memoryId, cosine(opts.queryVector as number[], r.vector)]));
  }

  const now = Date.now();
  const scored: ScoredMemory[] = candidates.map((r) => {
    const lexical = lex.get(r.memoryId) ?? 0;
    const vector = vecScores.get(r.memoryId) ?? 0;
    const recency = Math.exp(-((now - Date.parse(r.lastConfirmedAt)) / 86_400_000) / 45); // ~45-day half-ish decay
    const statusBoost = r.status === 'confirmed' ? 0.25 : r.status === 'inferred' ? 0 : -0.15;
    const score =
      lexical * 1.0 +
      vector * 1.2 +
      recency * 0.35 +
      r.importance * 0.5 +
      (r.confidence ?? 0.7) * 0.2 +
      (r.pinned ? 0.8 : 0) +
      statusBoost;
    return { record: r, score, lexical, vector };
  });
  return scored
    .filter((s) => s.score > 0.15 || s.record.pinned)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 12);
}

/** ~4 chars/token heuristic — good enough for budget capping. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface MemoryContext {
  lines: string[];
  text: string;
  usedMemoryIds: string[];
  tokenEstimate: number;
}

/** The provenance-carrying packet section Jarvis actually reads. */
export async function buildMemoryContext(actor: MemoryActor, query: string, opts: { tokenBudget?: number; queryVector?: number[] | null } = {}): Promise<MemoryContext> {
  const budget = opts.tokenBudget ?? 900;
  const results = await searchMemories(actor, query, { limit: 20, queryVector: opts.queryVector ?? null });
  const lines: string[] = [];
  const used: string[] = [];
  let tokens = 0;
  for (const { record: r } of results) {
    const tag = r.status === 'confirmed' ? 'CONFIRMED' : r.status === 'inferred' ? 'INFERRED' : 'TEMP';
    const line = `- [${tag}/${r.kind}${r.pinned ? '/pinned' : ''}] ${r.subject ? `${r.subject}: ` : ''}${r.content} (src:${r.provenance.sourceType}, ${r.lastConfirmedAt.slice(0, 10)}, id:${r.memoryId})`;
    const cost = approxTokens(line);
    if (tokens + cost > budget) break;
    tokens += cost;
    lines.push(line);
    used.push(r.memoryId);
  }
  return { lines, text: lines.join('\n'), usedMemoryIds: used, tokenEstimate: tokens };
}

export async function listMemories(actor: MemoryActor, opts: { kinds?: MemoryKind[]; limit?: number; includeDeleted?: boolean } = {}): Promise<MemoryRecord[]> {
  const filter: Record<string, unknown> = { ...scopeFilter(actor) };
  if (!opts.includeDeleted) filter.deletedAt = null;
  if (opts.kinds?.length) filter.kind = { $in: opts.kinds };
  return records().find(filter as never, { projection: { _id: 0 } as never }).sort({ pinned: -1, updatedAt: -1 }).limit(opts.limit ?? 100).toArray();
}

export async function getMemory(actor: MemoryActor, memoryId: string): Promise<MemoryRecord | null> {
  return records().findOne({ ...scopeFilter(actor), memoryId } as never, { projection: { _id: 0 } as never });
}
