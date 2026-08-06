/**
 * Memory retrieval — candidate selection policy and ranking (D-215).
 *
 * THE BUG THIS EXISTS TO FIX
 * --------------------------
 * `searchMemories` selected candidates like this:
 *
 *     records().find(filter).sort({ updatedAt: -1 }).limit(400)
 *
 * and then scored them in Node. Which means relevance was only ever computed
 * over the 400 most recently touched rows. A memory older than that was
 * invisible no matter how well it matched — and it failed silently, returning
 * a confident answer built on an incomplete search. Worse, it degrades with
 * use: the more the owner tells Jarvis, the more of what they told it drops
 * out of reach.
 *
 * It also broke a promise made two lines below it. The final filter reads
 * `score > 0.15 || record.pinned` — pinned memories are meant to always
 * surface. A pinned record outside the 400 window never got the chance.
 *
 * WHAT IS PURE AND WHAT IS NOT
 * ----------------------------
 * Everything in this file is pure: mode selection, the ranking function, and
 * the union policy. Database access stays in `index.ts`, which keeps this file
 * out of the scope-boundary allowlist and — more usefully — makes the ranking
 * testable without a database at all.
 */
import type { MemoryRecord } from './index.js';

/**
 * Where candidates come from.
 *
 * `in_process` is the historical path, byte-for-byte, and remains the default:
 * it needs no Atlas index and works against a plain mongod, which is what the
 * contract tests and any local deployment run on.
 *
 * `atlas_hybrid` asks Atlas to rank by RELEVANCE across the whole collection
 * instead of by recency across a window. It requires two search indexes; when
 * they are absent the caller falls back rather than failing, because a missing
 * index must never mean a missing memory.
 */
export type RetrievalMode = 'in_process' | 'atlas_hybrid';

export function retrievalModeFromEnv(env: NodeJS.ProcessEnv = process.env): RetrievalMode {
  return env.MEMORY_RETRIEVAL_MODE === 'atlas_hybrid' ? 'atlas_hybrid' : 'in_process';
}

/** Index names the Atlas path depends on. Owner-created; see the setup doc. */
export const MEMORY_TEXT_INDEX = 'memory_text';
export const MEMORY_VECTOR_INDEX = 'memory_vector';

/**
 * How many rows the recency window may hold in `in_process` mode.
 *
 * Kept at the historical 400 deliberately. Raising it would trade a silent
 * correctness bug for a silent performance one — every row is scored in Node —
 * and would still be a window. The fix for the window is `atlas_hybrid`, not a
 * bigger number.
 */
export const IN_PROCESS_CANDIDATE_LIMIT = 400;

export interface ScoreInputs {
  /** Lexical relevance in [0, ~1]. */
  lexical: number;
  /** Cosine similarity in [-1, 1]; 0 when no vector is available. */
  vector: number;
  /** Evaluated at this instant, so the function stays pure. */
  now: number;
}

/**
 * The product's opinion about which memory matters, as distinct from which
 * memory MATCHES.
 *
 * Retrieval finds candidates; this decides between them. The distinction is
 * the reason it lives in one shared function rather than inside either path:
 * an owner-confirmed, pinned, important memory must outrank a slightly better
 * lexical match in every mode, or Jarvis's sense of what is significant would
 * change depending on which indexes happen to exist on the cluster.
 *
 * Weights are unchanged from the original inline expression.
 */
export function memoryScore(record: MemoryRecord, s: ScoreInputs): number {
  const recency = Math.exp(-((s.now - Date.parse(record.lastConfirmedAt)) / 86_400_000) / 45); // ~45-day half-ish decay
  const statusBoost = record.status === 'confirmed' ? 0.25 : record.status === 'inferred' ? 0 : -0.15;
  return (
    s.lexical * 1.0 +
    s.vector * 1.2 +
    recency * 0.35 +
    record.importance * 0.5 +
    (record.confidence ?? 0.7) * 0.2 +
    (record.pinned ? 0.8 : 0) +
    statusBoost
  );
}

/** The cut applied after scoring. Pinned always survives — that is its point. */
export function isRetainable(record: MemoryRecord, score: number): boolean {
  return score > 0.15 || record.pinned;
}

/**
 * Merge candidate sets from several sources, keeping the first sighting.
 *
 * Order within a source is discarded — everything is rescored afterwards — but
 * identity is not: the same record arriving from both the text index and the
 * vector index must appear once, or it competes with itself and distorts the
 * lexical `docFreq` statistics computed over the candidate set.
 */
export function unionById(...groups: MemoryRecord[][]): MemoryRecord[] {
  const seen = new Map<string, MemoryRecord>();
  for (const g of groups) {
    for (const r of g) if (!seen.has(r.memoryId)) seen.set(r.memoryId, r);
  }
  return [...seen.values()];
}
