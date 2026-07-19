# CIN v2 — Master Plan (Collective Intelligence Network)

**Status:** ACTIVE — this is the strategic north star for all work after K2.
**Source:** `docs/CIN v2.pdf` (founder proposal, Ehsan Rahimi, 20 pages, Persian).
**Relationship to other docs:** `docs/master-direction.md` remains the engineering
arbiter for *how* we build (honesty, no service sprawl, verify-first).
This document defines *what* we are building toward. `docs/current-state.md`
remains the authoritative as-built snapshot.

---

## خلاصه فارسی (برای مالک)

CIN v2 یعنی تبدیل کرنل AOS به «سیستم‌عامل تمدنی»: هویت دیجیتال زنده برای
فرد/سازمان/شهر/دولت/ایجنت/ربات، سیستم‌عامل شخصی (جارویز زندهٔ ریل‌تایم)،
لایه اعتماد قابل‌راستی‌آزمایی (امضا + دفترکل زنجیره‌هش داخلی، بدون وابستگی به
سرویس خارجی)، لایه سازمانی و قراردادی، شبکه تصمیم‌گیری جمعی و مدل زنده جهان —
همه روی همین کرنل موجود، مرحله‌به‌مرحله، با تأیید انسانی و مستندسازی کامل.
فازها: CIN-1 (هویت و اعتماد) ← CIN-2 (جارویز زنده) ← CIN-3 (سازمان/قرارداد/تراکنش)
← CIN-4 (تصمیم جمعی + مدل جهان) ← CIN-5 (اتصال بیرونی و ربات‌ها) ← CIN-6 (فدراسیون و مقیاس).

---

## 1. What CIN v2 is (from the proposal, normalized)

The proposal defines CIN as a **civilizational operating system**: a global,
living, trusted infrastructure connecting people, organizations, cities,
governments, AI agents and robots. Its components (proposal §4):

| # | CIN component (proposal) | Kernel realization |
|---|---|---|
| 1 | Personal OS (§6) | Jarvis (K2) — upgraded to a live, realtime presence (CIN-2) |
| 2 | Global identity network (§5,7) | **CIN Entity Graph** — living identities for every entity type (CIN-1) |
| 3 | Digital trust infrastructure (§16) | **CIN Trust Layer** — Ed25519 signatures, verifiable claims, hash-chained ledger, in-house (CIN-1) |
| 4 | Organization management system (§7) | Org entities + org OS views (CIN-3) |
| 5 | Intelligent coordination engine (§9) | Orchestrator + shared agent loop + missions (exists; extended each phase) |
| 6 | Collective decision network (§11) | Decision records + simulation + multi-entity approval (CIN-4) |
| 7 | Legal/contract infrastructure (§14) | Digital contracts w/ signatures + lifecycle (CIN-3) |
| 8 | Financial/transaction network (§15) | Internal transaction ledger + attestations (CIN-3) |
| 9 | Government interaction system (§8) | City/region/government entity layers (CIN-4/5) |
| 10 | AI-agent management platform (§12) | Agent entities in the graph + governed tool registry (CIN-1 onward) |
| 11 | Robot control/coordination (§13) | Device/robot entities + device protocol (CIN-5) |
| 12 | Living world model (§10) | World-model indicators + state snapshots (CIN-4) |
| 13 | Civilizational analysis & decision core (§9) | Intelligence core: models + simulation over the graph (CIN-4+) |

**Non-negotiable principles carried from the proposal (§17,18,27):**
human-centric final authority (approvals stay), verifiable trust (signatures,
not promises), selective disclosure (prove a claim without revealing all data),
realtime interaction, interoperability, scalability from one person to global,
future-readiness (advanced AI, robots, quantum-resistant crypto path).

## 2. Where we start from (as-built, commit `cb98e5e`)

Real assets we build on — nothing is thrown away:

- **K2 agent core:** shared multi-turn loop, governed tool registry, native
  Anthropic/OpenAI-compatible providers, roles.
- **Jarvis:** persistent sessions, SSE streaming, approval pause/resume,
  Memory v2 (bilingual FA/EN), missions hierarchy, briefing/watches, selfdev
  pipeline.
- **Governance:** approvals, policy, scope/tenant schemas, audit, honesty ethos.
- **Infra:** Mongo + Redis + BullMQ queue (K1, runtime-verified), Fastify
  gateway (4101), Next.js dashboard (3000), 19 service shells.

Known structural truths (from `master-direction.md`) that shape CIN decisions:
the real architecture is **one shared library + gateway + thin proxies**; we do
NOT add new deployables per CIN pillar. CIN pillars are **domain modules in
`shared/src/cin/*` exposed through gateway routes `/v1/cin/*`** until scale
genuinely demands a split. This is a deliberate anti-sprawl decision (D-179).

## 3. Technology posture

- **Self-source first (owner requirement):** every core capability implemented
  in-repo. Trust layer uses Node's built-in `crypto` (Ed25519 + SHA-256
  hash-chain) — no external blockchain, no third-party trust API. LLMs remain
  swappable (local Ollama/vLLM first-class; Anthropic/OpenAI optional).
- **Stack:** TypeScript strict, Zod v3 contracts, Fastify, Next.js, MongoDB,
  Redis, SSE (WebSocket when bidirectional realtime is needed in CIN-2).
- **Quantum path:** all signing goes through one `cin/trust` abstraction with a
  declared `alg` field (`ed25519` today). When Node ships NIST PQC (ML-DSA),
  we add it as a new `alg` and dual-sign during migration. No design change
  needed later — this satisfies proposal §19 without betting on immature libs.
- **Verification discipline:** every phase lands with contract tests + a
  runtime-verify script; status vocabulary (`RUNTIME_VERIFIED`, `CODE_COMPLETE`,
  `BLOCKED_EXTERNAL`, `PRODUCT_VERIFIED`) is unchanged.

## 4. Phase roadmap (CIN phases — fast, verifiable slices)

Each phase is shippable alone, documented in `phase-log.md`, decisions in
`decision-log.md`, and updates `current-state.md`.

### CIN-1 — Trust & Identity Core  ← **STARTED (this phase)**
The root of everything: nothing in CIN is meaningful without identity + trust.

1. **Entity Graph** (`shared/src/cin/entities.ts`): one collection
   `cin_entities` with `entityType` discriminator: `person | organization |
   org_unit | city | region | government | ai_agent | robot | device |
   service`. Living identity = versioned profile sections (identity, education,
   employment, financial, legal, health-ref, preferences, capabilities…) with
   per-section visibility. Typed relations in `cin_relations`
   (`member_of, owns, operates, governs, represents, delegates_to, located_in,
   contracts_with`).
2. **Trust Layer** (`shared/src/cin/trust.ts`): per-entity Ed25519 keypair
   (private keys in `cin_keys`, never returned by API); **verifiable claims**
   (`cin_claims`): issuer signs `{subject, claimType, payload}`; verify without
   contacting issuer; revocation; expiry; selective disclosure via payload
   hashing (prove claim validity revealing only chosen fields).
3. **CIN Ledger** (`shared/src/cin/ledger.ts`): append-only hash chain
   (`cin_ledger`): every sensitive act (entity created, claim issued/revoked,
   relation changed, decision recorded) becomes a chained record
   `hash = sha256(prevHash + canonical(record))`; `verifyChain()` proves
   tamper-evidence. This is the proposal's §16 without external blockchain.
4. **Gateway surface:** `/v1/cin/entities*`, `/v1/cin/relations*`,
   `/v1/cin/claims*`, `/v1/cin/ledger*` (owner/internal-guarded, scope-stamped).
5. Owner (Ehsan) + Jarvis + the kernel itself are seeded as the first three
   entities — the system's own identity lives in its own graph from day one.

**Acceptance:** contract tests green; chain verification detects tampering;
claim signed by A verifies and fails after revocation; docs updated.

### CIN-2 — Living Personal OS (Jarvis leaves chatbot mode)
- Continuous presence: a **background heartbeat loop** per owner (BullMQ
  repeatable job) that reviews missions/watches/memory and pushes proactive
  events — Jarvis acts between conversations, not only when spoken to.
- **Realtime channel:** upgrade dashboard from request/SSE-per-turn to a
  persistent event stream (SSE now, WS if needed): presence state, live agent
  activity, proactive cards, instant approvals.
- Personal OS view over the entity graph: the owner's living identity page
  (profile sections, claims held, relations, missions, finances) — the
  proposal's §6 checklist mapped to concrete panels.
- Latency work: streaming-first turns, tool-step streaming already exists —
  wire it to model streaming end-to-end; local model path prioritized.

### CIN-3 — Organizational + Legal + Financial layer
- Org entities with membership/roles (employment claims are verifiable claims).
- **Digital contracts:** contract records signed by both entities' keys,
  lifecycle (draft→signed→active→fulfilled/disputed→closed), ledger-anchored.
- **Transaction ledger:** internal value/obligation records between entities
  (attested, chained) — accounting truth first; external payment rails later
  and only via approval-gated connectors.

### CIN-4 — Collective decisions + Living World Model v1
- Decision records at any entity level (individual→org→city→…), options,
  simulated consequences (agent-run analyses), votes/sign-offs as claims,
  final human authority preserved (proposal §18).
- World model v1: indicator framework (population/economy/health/… per entity
  scope) fed by research service + connectors; snapshot + trend + effect links.

### CIN-5 — External connectivity + Robots/Devices
- Public API surface + per-entity API keys (institutions interact with CIN).
- Device/robot registry: identity, ownership, authority level, mission
  reception, telemetry, emergency stop (proposal §13) — protocol first,
  hardware later.

### CIN-6 — Federation & scale
- Multi-node CIN (federated instances exchanging signed claims), true
  multi-tenant enforcement at the query layer, PQC dual-signing, performance
  hardening.

## 5. Operating rules for every CIN phase

1. Read `current-state.md` first; never re-audit blindly.
2. No new deployable services without a measured reason (D-179).
3. Every mutation of trust-relevant state goes through the ledger.
4. Human approval gates stay on all sensitive/irreversible actions.
5. Docs updated in the same commit as code (`phase-log`, `decision-log`,
   `current-state`, this plan's phase status).
6. Latest stable tech only; self-source first; external APIs optional-only.
7. Bilingual awareness (FA/EN) in all user-facing surfaces.

## 6. Phase status board

| Phase | Status | Evidence |
|---|---|---|
| CIN-1 Trust & Identity Core | **IN PROGRESS** (first slice landed) | `shared/src/cin/*`, `shared/test/cin.contract.test.ts`, `/v1/cin/*` |
| CIN-2 Living Personal OS | PLANNED | — |
| CIN-3 Org/Legal/Financial | PLANNED | — |
| CIN-4 Decisions + World Model | PLANNED | — |
| CIN-5 External + Robots | PLANNED | — |
| CIN-6 Federation & scale | PLANNED | — |
