/**
 * CIN Trust Layer (CIN-1, D-179) — per-entity signing keys and verifiable
 * claims. In-house realization of proposal §5/§16/§17: trust backed by
 * cryptography, not promises; selective disclosure by design.
 *
 * - Keys: Ed25519 via Node's built-in crypto (no external dependency). The
 *   `alg` field on every key/claim is the quantum-migration seam: when Node
 *   ships NIST PQC (ML-DSA), it becomes a new alg value and entities
 *   dual-sign during migration — no schema change.
 * - Claims: issuer signs {issuer, subject, claimType, payloadHash, issuedAt,
 *   expiresAt}. Verification needs only the claim + the issuer's PUBLIC key
 *   (offline/federation-ready). Payload is hashed, so a holder can present a
 *   redacted payload and still prove issuer endorsement (field-level Merkle
 *   disclosure is the planned CIN-3 upgrade of the same design).
 * - SECURITY INVARIANT: private keys never leave this module's collection;
 *   no exported function returns them, no API route exposes them.
 */
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { canonicalJson, sha256Hex, appendLedger } from './ledger.js';

export const CinKeySchema = z.object({
  keyId: z.string(),
  entityId: z.string(),
  alg: z.literal('ed25519').default('ed25519'),
  publicKeyPem: z.string(),
  /** Encrypt at rest / move to KMS before multi-node (architecture §2.3). */
  privateKeyPem: z.string(),
  status: z.enum(['active', 'retired']).default('active'),
  createdAt: z.string(),
});
export type CinKey = z.infer<typeof CinKeySchema>;

export const CinClaimSchema = z.object({
  claimId: z.string(),
  issuerEntityId: z.string(),
  subjectEntityId: z.string(),
  /** Free vocabulary, dot-namespaced: 'identity.name', 'employment.role',
   *  'education.degree', 'kernel.genesis', 'membership', ... */
  claimType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  payloadHash: z.string(),
  alg: z.literal('ed25519').default('ed25519'),
  keyId: z.string(),
  signature: z.string(), // base64
  issuedAt: z.string(),
  expiresAt: z.string().nullable().default(null),
  revokedAt: z.string().nullable().default(null),
  revocationReason: z.string().nullable().default(null),
});
export type CinClaim = z.infer<typeof CinClaimSchema>;

const keysCol = () => collection<CinKey>(COLLECTIONS.CIN_KEYS);
const claimsCol = () => collection<CinClaim>(COLLECTIONS.CIN_CLAIMS);

/** The exact bytes a claim signature covers. Payload participates via its
 *  hash only — that is what makes selective disclosure possible. */
function claimSigningBase(c: Pick<CinClaim, 'issuerEntityId' | 'subjectEntityId' | 'claimType' | 'payloadHash' | 'issuedAt' | 'expiresAt'>): string {
  return canonicalJson({
    issuerEntityId: c.issuerEntityId,
    subjectEntityId: c.subjectEntityId,
    claimType: c.claimType,
    payloadHash: c.payloadHash,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
  });
}

export async function createEntityKey(entityId: string): Promise<{ keyId: string; publicKeyPem: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key: CinKey = {
    keyId: genId('cinkey'),
    entityId,
    alg: 'ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    status: 'active',
    createdAt: nowIso(),
  };
  await keysCol().insertOne(key as never);
  await appendLedger({ recordType: 'key.created', refId: key.keyId, actorEntityId: entityId, summary: `signing key created for ${entityId}`, data: { alg: key.alg } });
  return { keyId: key.keyId, publicKeyPem: key.publicKeyPem };
}

export async function getActiveKey(entityId: string): Promise<CinKey | null> {
  const doc = await keysCol().findOne({ entityId, status: 'active' });
  return doc ? CinKeySchema.parse(doc) : null;
}

/** Public info only — safe for API exposure. */
export async function getPublicKey(entityId: string): Promise<{ keyId: string; alg: string; publicKeyPem: string } | null> {
  const key = await getActiveKey(entityId);
  return key ? { keyId: key.keyId, alg: key.alg, publicKeyPem: key.publicKeyPem } : null;
}

export interface IssueClaimInput {
  issuerEntityId: string;
  subjectEntityId: string;
  claimType: string;
  payload?: Record<string, unknown>;
  expiresAt?: string | null;
  actorEntityId?: string;
}

export async function issueClaim(input: IssueClaimInput): Promise<CinClaim> {
  const key = await getActiveKey(input.issuerEntityId);
  if (!key) throw new Error(`issuer ${input.issuerEntityId} has no active signing key`);
  const payload = input.payload ?? {};
  const issuedAt = nowIso();
  const expiresAt = input.expiresAt ?? null;
  const payloadHash = sha256Hex(canonicalJson(payload));
  const base = { issuerEntityId: input.issuerEntityId, subjectEntityId: input.subjectEntityId, claimType: input.claimType, payloadHash, issuedAt, expiresAt };
  const signature = edSign(null, Buffer.from(claimSigningBase(base), 'utf8'), key.privateKeyPem).toString('base64');
  const claim: CinClaim = {
    claimId: genId('claim'),
    ...base,
    payload,
    alg: 'ed25519',
    keyId: key.keyId,
    signature,
    revokedAt: null,
    revocationReason: null,
  };
  await claimsCol().insertOne(claim as never);
  await appendLedger({
    recordType: 'claim.issued', refId: claim.claimId,
    actorEntityId: input.actorEntityId ?? input.issuerEntityId,
    summary: `${input.issuerEntityId} → ${input.subjectEntityId}: ${input.claimType}`,
    data: { payloadHash, expiresAt },
  });
  return claim;
}

export async function getClaim(claimId: string): Promise<CinClaim | null> {
  const doc = await claimsCol().findOne({ claimId });
  return doc ? CinClaimSchema.parse(doc) : null;
}

export async function listClaims(filter: { subjectEntityId?: string; issuerEntityId?: string; claimType?: string } = {}): Promise<CinClaim[]> {
  const f: Record<string, unknown> = {};
  if (filter.subjectEntityId) f.subjectEntityId = filter.subjectEntityId;
  if (filter.issuerEntityId) f.issuerEntityId = filter.issuerEntityId;
  if (filter.claimType) f.claimType = filter.claimType;
  const docs = await claimsCol().find(f).sort({ issuedAt: -1 }).limit(500).toArray();
  return docs.map((d) => CinClaimSchema.parse(d));
}

export interface ClaimVerification {
  claimId: string;
  valid: boolean;
  checks: { signature: boolean; notExpired: boolean; notRevoked: boolean; payloadMatchesHash: boolean };
  reason: string | null;
}

export async function verifyClaim(claimId: string, now = nowIso()): Promise<ClaimVerification> {
  const claim = await getClaim(claimId);
  if (!claim) return { claimId, valid: false, checks: { signature: false, notExpired: false, notRevoked: false, payloadMatchesHash: false }, reason: 'claim not found' };
  const keyDoc = await keysCol().findOne({ keyId: claim.keyId });
  const checks = { signature: false, notExpired: true, notRevoked: true, payloadMatchesHash: false };
  if (keyDoc) {
    const key = CinKeySchema.parse(keyDoc);
    checks.signature = edVerify(null, Buffer.from(claimSigningBase(claim), 'utf8'), key.publicKeyPem, Buffer.from(claim.signature, 'base64'));
  }
  checks.payloadMatchesHash = sha256Hex(canonicalJson(claim.payload)) === claim.payloadHash;
  if (claim.expiresAt && claim.expiresAt <= now) checks.notExpired = false;
  if (claim.revokedAt) checks.notRevoked = false;
  const valid = checks.signature && checks.notExpired && checks.notRevoked && checks.payloadMatchesHash;
  const reason = valid ? null
    : !keyDoc ? 'issuer key not found'
    : !checks.signature ? 'signature invalid'
    : !checks.payloadMatchesHash ? 'payload does not match signed hash'
    : !checks.notRevoked ? `revoked: ${claim.revocationReason ?? 'no reason recorded'}`
    : 'expired';
  return { claimId, valid, checks, reason };
}

export async function revokeClaim(claimId: string, reason: string, actorEntityId?: string): Promise<CinClaim> {
  const claim = await getClaim(claimId);
  if (!claim) throw new Error(`claim ${claimId} not found`);
  if (claim.revokedAt) return claim;
  const revokedAt = nowIso();
  await claimsCol().updateOne({ claimId }, { $set: { revokedAt, revocationReason: reason } });
  await appendLedger({
    recordType: 'claim.revoked', refId: claimId,
    actorEntityId: actorEntityId ?? claim.issuerEntityId,
    summary: `claim ${claim.claimType} revoked`, data: { reason },
  });
  return { ...claim, revokedAt, revocationReason: reason };
}
