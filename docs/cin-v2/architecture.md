# CIN v2 — Technical Architecture

**Scope:** the concrete data model, module layout, API surface and invariants
for the CIN layer. Read `docs/cin-v2/master-plan.md` first for the why.

---

## 1. Module layout (anti-sprawl, D-179)

CIN is a **domain layer inside the existing kernel**, not a fleet of new
services:

```txt
shared/src/cin/
├── index.ts        # single export surface
├── entities.ts     # entity graph: cin_entities + cin_relations
├── trust.ts        # keys, signatures, verifiable claims, selective disclosure
└── ledger.ts       # append-only hash-chained tamper-evident ledger
services/gateway-api/src/routes/cin.ts   # /v1/cin/* HTTP surface
shared/test/cin.contract.test.ts         # contract suite
```

Future phases add sibling modules (`contracts.ts`, `transactions.ts`,
`decisions.ts`, `worldmodel.ts`, `devices.ts`) behind the same surface.

## 2. Data model

### 2.1 `cin_entities` — living identities
One collection, `entityType` discriminator:
`person | organization | org_unit | city | region | government | ai_agent |
robot | device | service`.

An entity's identity is **living**: a set of versioned **profile sections**
(`identity, contact, education, credentials, employment, skills, financial,
assets, legal, health_ref, memberships, achievements, preferences, goals,
capabilities, custom:*`). Each section carries:

- `data` (free-form object, schema-checked at the edges that consume it),
- `visibility`: `private | restricted | network | public`,
- `version`, `updatedAt`, `updatedBy`,
- optional `attestedBy` (claim ids that back this section).

Invariants:
- Sections are replaced whole and version-incremented — no silent partial edits.
- Every entity mutation appends a ledger record (see §2.4).
- Entities are scope-stamped (`ScopeFieldsSchema`) like all kernel data.

### 2.2 `cin_relations` — typed edges
`{relationId, fromEntityId, toEntityId, relationType, role?, since?, until?,
status: active|ended, attestingClaimId?}` with
`relationType ∈ member_of | owns | operates | governs | represents |
delegates_to | located_in | contracts_with | parent_of | connected_to`.
Both endpoints must exist; duplicate active edges of the same type between the
same pair are rejected.

### 2.3 `cin_keys` + `cin_claims` — trust
- **Keys:** per-entity Ed25519 keypair generated with Node `crypto`
  (`alg: 'ed25519'` recorded per key for the PQC migration path). Private keys
  live only in `cin_keys` (deployment note: encrypt at rest / move to KMS
  before multi-node). **No API ever returns a private key.**
- **Claims** (`cin_claims`): `{claimId, issuerEntityId, subjectEntityId,
  claimType, payload, payloadHash, alg, signature, issuedAt, expiresAt?,
  revokedAt?, revocationReason?}`.
  - Signature = sign(canonical(`{issuer, subject, claimType, payloadHash,
    issuedAt, expiresAt}`)) with the **issuer's** private key.
  - `verifyClaim` needs only the claim + issuer public key: checks signature,
    expiry, revocation. Works offline/federated later.
  - **Selective disclosure:** `payloadHash = sha256(canonical(payload))` is
    what is signed; the holder may present the claim with a redacted payload
    plus the hash — a verifier confirms issuer endorsement of *something* the
    holder can later prove field-by-field (field-level Merkle disclosure is a
    CIN-3 upgrade; the hash design already permits it).

### 2.4 `cin_ledger` — tamper-evident history
Append-only chain per deployment (`chainId: 'main'` for now):
`{seq, chainId, recordType, refId, actorEntityId, summary, data, prevHash,
hash, at}` where `hash = sha256(prevHash + canonical(everything else))`.
- Genesis record has `prevHash = 'GENESIS'`.
- `appendLedger` serializes writes (per-chain lock via findOneAndUpdate on a
  head pointer doc) to keep the chain linear under concurrency.
- `verifyChain(chainId)` re-hashes the full chain and reports the first broken
  link, if any. This gives proposal-§16 guarantees (immutability *evidence*,
  fraud detection) without external blockchain. Federation (CIN-6) can anchor
  head hashes across nodes.

Ledgered record types (CIN-1): `entity.created, entity.section_updated,
entity.status_changed, relation.created, relation.ended, claim.issued,
claim.revoked, key.created`.

## 3. API surface (gateway, all owner/internal-guarded, scope-stamped)

```txt
POST   /v1/cin/entities                  create entity (+key +ledger +genesis claims)
GET    /v1/cin/entities                  list (filter by type/status/q)
GET    /v1/cin/entities/:id              full entity (visibility-filtered)
PUT    /v1/cin/entities/:id/sections/:section   replace section (versioned)
POST   /v1/cin/relations                 create typed edge
POST   /v1/cin/relations/:id/end         end edge
GET    /v1/cin/entities/:id/graph        entity + edges (1-hop)
POST   /v1/cin/claims                    issue claim (issuer signs)
GET    /v1/cin/claims/:id/verify         verify signature/expiry/revocation
POST   /v1/cin/claims/:id/revoke         revoke (issuer only)
GET    /v1/cin/ledger                    list records (paged)
GET    /v1/cin/ledger/verify             full chain verification report
```

All responses use the kernel envelope (`success/failure`), all writes audit +
ledger. Jarvis gains governed tools over this surface in CIN-2 (tool family
`cin`), so the owner can manage identity conversationally.

## 4. Realtime direction (CIN-2 preview)

- Keep SSE as transport; add a **persistent owner stream**
  (`/v1/stream/owner`) multiplexing: presence, proactive Jarvis events,
  approval requests, ledger/graph changes. Dashboard subscribes once.
- Heartbeat loop = BullMQ repeatable job (`jarvis-heartbeat`, per owner):
  wake → snapshot (missions, watches, memory deltas, world events) → decide
  (agent loop, budgeted) → emit proactive cards / take governed actions.
- Voice + sub-second local-model turns are the CIN-2 quality bar for "alive".

## 5. Security invariants

1. Private keys never leave the trust module; no route returns them.
2. Ledger append is the ONLY write path to `cin_ledger`; no updates/deletes.
3. Claim issuance requires the acting auth context to control the issuer
   entity (owner controls all in single-operator mode — enforced hook exists
   for multi-tenant later).
4. Sensitive actions remain approval-gated exactly as before; CIN adds
   evidence, it never bypasses governance.
5. Visibility filtering is applied server-side on read (private sections only
   to owner/internal).
