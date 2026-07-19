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
 * - Single-writer per process today (single-operator kernel). Before
 *   multi-node: add a unique index on {chainId, seq} and retry on conflict
 *   (documented in docs/cin-v2/architecture.md).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { collection } from '../db/index.js';
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
const ledgerCol = () => collection<CinLedgerRecord>(COLLECTIONS.CIN_LEDGER);

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

export async function appendLedger(input: AppendLedgerInput): Promise<CinLedgerRecord> {
  const chainId = input.chainId ?? 'main';
  const head = await ledgerCol().find({ chainId }).sort({ seq: -1 }).limit(1).toArray();
  const prev = head[0];
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
  await ledgerCol().insertOne(record as never);
  return record;
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

/** Re-hash the entire chain and report the first broken link, if any. */
export async function verifyChain(chainId = 'main'): Promise<ChainVerification> {
  const docs = await ledgerCol().find({ chainId }).sort({ seq: 1 }).toArray();
  let prevHash = GENESIS_HASH;
  for (const [i, doc] of docs.entries()) {
    const parsed = CinLedgerRecordSchema.parse(doc);
    if (parsed.seq !== i) {
      return { chainId, ok: false, length: docs.length, headHash: null, brokenAtSeq: parsed.seq, reason: `sequence gap: expected ${i}, found ${parsed.seq}` };
    }
    if (parsed.prevHash !== prevHash) {
      return { chainId, ok: false, length: docs.length, headHash: null, brokenAtSeq: parsed.seq, reason: 'prevHash does not match previous record hash' };
    }
    const { hash, ...rest } = parsed;
    if (computeHash(rest) !== hash) {
      return { chainId, ok: false, length: docs.length, headHash: null, brokenAtSeq: parsed.seq, reason: 'record content does not match its hash (tampered)' };
    }
    prevHash = hash;
  }
  return { chainId, ok: true, length: docs.length, headHash: docs.length ? prevHash : null, brokenAtSeq: null, reason: null };
}
