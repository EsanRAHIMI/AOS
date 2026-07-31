/**
 * CIN Ledger (CIN-1, D-179) — append-only, hash-chained, tamper-evident
 * history of every trust-relevant act in the network.
 *
 * This is the kernel's in-house realization of proposal §16 (blockchain /
 * trust technologies): immutability EVIDENCE without an external blockchain.
 * Each record chains to the previous one via
 *   hash = sha256(prevHash + canonical(record-without-hash))
 * so any later mutation of any record breaks every subsequent hash and is
 * detected by `verifyChain()`. Federation (CIN-6) can anchor head hashes
 * across nodes; a PQC hash upgrade slots in via the `alg` field.
 *
 * Invariants:
 * - `appendLedger` is the ONLY write path; there are no update/delete APIs.
 * - Linearity is enforced by the DATABASE (D-186): a unique index on
 *   {chainId, seq} means two concurrent writers cannot claim the same slot,
 *   and the loser retries against the advanced head. This replaces the old
 *   "single-writer per process" assumption, which a multi-instance deployment
 *   could have violated silently.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { globalCollection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';

/** Stable stringify: objects get sorted keys recursively so the same logical
 *  value always produces the same bytes (and therefore the same hash). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export const CIN_LEDGER_RECORD_TYPES = [
  'entity.created',
  'entity.section_updated',
  'entity.status_changed',
  'relation.created',
  'relation.ended',
  'claim.issued',
  'claim.revoked',
  'key.created',
  // CIN-2b (D-181): every completed Living Loop cycle is anchored in the chain.
  'cycle.completed',
  // CIN-1b (D-185): the owner's paperwork has the same tamper-evident history
  // as the rest of their identity.
  'document.registered',
  'document.updated',
  'document.archived',
  'document.file_attached',
] as const;

export const CinLedgerRecordSchema = z.object({
  ledgerId: z.string(),
  chainId: z.string().default('main'),
  seq: z.number().int().nonnegative(),
  recordType: z.enum(CIN_LEDGER_RECORD_TYPES),
  /** Id of the thing this record is about (entityId/relationId/claimId/keyId). */
  refId: z.string(),
  actorEntityId: z.string().default('system'),
  summary: z.string().default(''),
  data: z.record(z.string(), z.unknown()).default({}),
  alg: z.literal('sha256').default('sha256'),
  prevHash: z.string(),
  hash: z.string(),
  at: z.string(),
});
export type CinLedgerRecord = z.infer<typeof CinLedgerRecordSchema>;

const GENESIS_HASH = 'GENESIS';
const ledgerCol = () => globalCollection<CinLedgerRecord>(COLLECTIONS.CIN_LEDGER);

function computeHash(record: Omit<CinLedgerRecord, 'hash'>): string {
  const { prevHash, ...rest } = record;
  return sha256Hex(prevHash + canonicalJson(rest));
}

export interface AppendLedgerInput {
  recordType: (typeof CIN_LEDGER_RECORD_TYPES)[number];
  refId: string;
  actorEntityId?: string;
  summary?: string;
  data?: Record<string, unknown>;
  chainId?: string;
}

/** Duplicate-key (E11000) — the database rejecting a violated constraint. */
function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/**
 * Append one record, atomically claiming the next sequence number.
 *
 * The unique index on `{chainId, seq}` (see db/indexes.ts) is what makes the
 * chain linear: if two writers read the same head, exactly one insert wins and
 * the loser gets E11000. Retrying re-reads the (now advanced) head, so a
 * concurrent append is a brief retry rather than a forked or corrupted chain.
 * Without both the index and this retry, "single-writer per process" was an
 * assumption the deployment could silently violate.
 */
export async function appendLedger(input: AppendLedgerInput, maxAttempts = 6): Promise<CinLedgerRecord> {
  const chainId = input.chainId ?? 'main';
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Index-backed head lookup: {chainId, seq} covers this exactly.
    const prev = await ledgerCol().find({ chainId }).sort({ seq: -1 }).limit(1).next();
    const base: Omit<CinLedgerRecord, 'hash'> = {
      ledgerId: genId('ledg'),
      chainId,
      seq: prev ? prev.seq + 1 : 0,
      recordType: input.recordType,
      refId: input.refId,
      actorEntityId: input.actorEntityId ?? 'system',
      summary: input.summary ?? '',
      data: input.data ?? {},
      alg: 'sha256',
      prevHash: prev ? prev.hash : GENESIS_HASH,
      at: nowIso(),
    };
    const record: CinLedgerRecord = { ...base, hash: computeHash(base) };
    try {
      await ledgerCol().insertOne(record as never);
      return record;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      lastError = err;
      // Someone else took this seq. Back off briefly and re-read the head.
      await new Promise((r) => setTimeout(r, 8 * (attempt + 1)));
    }
  }
  throw new Error(`ledger append failed after ${maxAttempts} attempts (concurrent writers): ${String(lastError)}`);
}

export async function listLedger(opts: { chainId?: string; limit?: number; afterSeq?: number } = {}): Promise<CinLedgerRecord[]> {
  const chainId = opts.chainId ?? 'main';
  const filter: Record<string, unknown> = { chainId };
  if (opts.afterSeq !== undefined) filter.seq = { $gt: opts.afterSeq };
  const docs = await ledgerCol().find(filter).sort({ seq: 1 }).limit(Math.min(opts.limit ?? 200, 1000)).toArray();
  return docs.map((d) => CinLedgerRecordSchema.parse(d));
}

export interface ChainVerification {
  chainId: string;
  ok: boolean;
  length: number;
  headHash: string | null;
  /** First broken link, if any. */
  brokenAtSeq: number | null;
  reason: string | null;
}

/**
 * Re-hash the whole chain and report the first broken link.
 *
 * STREAMED, never `toArray()`: this chain is append-only and grows for the
 * life of the system, so materialising it would make verification's memory
 * cost grow without bound — the one operation that must still work when the
 * ledger is large. The cursor walks it in index order ({chainId, seq}) and
 * holds a single record at a time.
 */
export async function verifyChain(chainId = 'main'): Promise<ChainVerification> {
  const cursor = ledgerCol().find({ chainId }).sort({ seq: 1 }).batchSize(500);
  let prevHash = GENESIS_HASH;
  let expectedSeq = 0;
  let length = 0;

  try {
    for await (const doc of cursor) {
      const parsed = CinLedgerRecordSchema.parse(doc);
      length += 1;
      if (parsed.seq !== expectedSeq) {
        return { chainId, ok: false, length, headHash: null, brokenAtSeq: parsed.seq, reason: `sequence gap: expected ${expectedSeq}, found ${parsed.seq}` };
      }
      if (parsed.prevHash !== prevHash) {
        return { chainId, ok: false, length, headHash: null, brokenAtSeq: parsed.seq, reason: 'prevHash does not match previous record hash' };
      }
      const { hash, ...rest } = parsed;
      if (computeHash(rest) !== hash) {
        return { chainId, ok: false, length, headHash: null, brokenAtSeq: parsed.seq, reason: 'record content does not match its hash (tampered)' };
      }
      prevHash = hash;
      expectedSeq += 1;
    }
  } finally {
    await cursor.close().catch(() => { /* cursor already exhausted */ });
  }
  return { chainId, ok: true, length, headHash: length ? prevHash : null, brokenAtSeq: null, reason: null };
}

/** Chain head without reading the chain — index-backed, O(1). */
export async function ledgerHead(chainId = 'main'): Promise<{ seq: number; hash: string } | null> {
  const doc = await ledgerCol().find({ chainId }).sort({ seq: -1 }).limit(1).next();
  if (!doc) return null;
  const parsed = CinLedgerRecordSchema.parse(doc);
  return { seq: parsed.seq, hash: parsed.hash };
}
