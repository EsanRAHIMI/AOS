# CIN-2b — The Autonomous Living Loop

**Status:** ACTIVE — this is the gate before CIN-3. Owner directive
(2026-07-19): *"contracts and transactions on top of a system without a live
loop is construction on land without electricity."* Nothing in CIN-3 starts
until this loop is RUNTIME_VERIFIED.

**Module:** `shared/src/livingloop/` · **Routes:** `/v1/loop/*` ·
**Dashboard:** `/loop` · **Verify:** `scripts/living-loop-verify.mjs`

---

## 1. The one scenario (end-to-end, fully operational)

Jarvis, with NO initial user message:

```txt
observe   ← raw events arrive in the loop inbox (heartbeat findings, watch
            firings, kernel events, external POSTs) — idempotent, deduped
snapshot  → rebuild the durable Owner State Snapshot; diff against previous
assess    → deterministic significance detection (what changed & why it matters)
reason    → REAL MODEL builds rationale + priority (honest fallback if absent)
plan      → multi-step plan; every step bound to a governed tool + risk level
execute   → low-risk steps run automatically; sensitive steps PAUSE for
            owner approval (exact resume, no re-execution)
review    → outcome check: did each step succeed? what actually changed?
update    → memory records + mission nodes + entity-graph sections + a CIN
            ledger anchor for the completed cycle
surface   → every stage visible LIVE on /loop and the owner stream:
            "what it saw · why it mattered · what it decided · what it did ·
            what happened"
```

## 2. Durable data model

| Collection | Purpose |
|---|---|
| `loop_inbox` | Raw events. Unique `eventKey` (idempotency by construction). `status: pending → processing → done \| failed → dead` with `attempts`, `lastError`, `latencyMs`. `dead` = DLQ, requeue-able. |
| `owner_state_snapshots` | Persistent Owner State Snapshot: missions health, open proactive events, trust-chain head, entity/claim counts, memory stats. `hash` (sha256 canonical) + `changedKeys` diff vs previous. |
| `loop_cycles` | One document per cycle — THE durable state machine. Every stage appends `{stage, at, durationMs, summary, ok}` and persists BEFORE the next stage starts (restart = resume, never redo). Holds significance, decision (`usedModel`/`usedFallback` honest flags), plan steps with per-step status, `pendingApprovalId`, budgets, outcome refs (memoryIds/missionIds/ledgerSeq). |

## 3. Resilience matrix (each row has a test or verify-script check)

| Failure | Behavior |
|---|---|
| Duplicate event | `eventKey` unique → second ingest returns `duplicate:true`, no new cycle |
| Process restart | cycles left in a working state are picked up by `resumeOpenCycles()` on next tick; a stage never re-executes (stage log is the checkpoint) |
| Model error / absent | reason stage falls back to deterministic prioritization, `usedFallback:true` recorded — the loop NEVER stops because a model is down |
| Stage timeout | per-stage wall-clock budget → cycle fails that stage, inbox event `attempts++`, retried up to `maxAttempts`, then DLQ |
| Redis outage | the loop is Mongo-durable; ticking degrades to the in-process interval; nothing is lost, only latency |
| Approval never answered | cycle parks at `awaiting_approval` indefinitely (durable); owner decision resumes exactly where it paused |
| Budget exhausted | cycle stops with explicit `budget_exhausted` stop reason — never silent |
| Replay | `POST /v1/loop/inbox/:id/replay` creates a NEW cycle marked `replayOf`, original untouched |

## 4. Acceptance criteria — the 24-hour demo (pass/fail gates)

The loop is DONE when ALL of the following hold in one continuous run on the
owner's machine (real Mongo Atlas + real Redis + a real model configured),
started with `pnpm --filter @factory/gateway-api dev` and **zero initial user
messages**:

1. **G1 — autonomy:** ≥ 24h uninterrupted; ≥ 10 cycles completed with zero
   human prompting (approvals excepted).
2. **G2 — real reasoning:** ≥ 1 cycle whose reason stage shows
   `usedModel:true, usedFallback:false` with a non-template rationale.
3. **G3 — latency recorded:** every inbox event has `latencyMs`
   (received → cycle completed); p50/p95 shown by the verify script.
4. **G4 — idempotency:** duplicate `eventKey` ingested twice → exactly one
   cycle (verify script asserts).
5. **G5 — replay:** a replayed event produces a second cycle with
   `replayOf` set, and the ledger anchors both.
6. **G6 — DLQ:** a poisoned event (forced failing stage) lands in `dead`
   after `maxAttempts`, is visible on `/loop`, and can be requeued.
7. **G7 — budget control:** a cycle with an exhausted budget stops with
   `budget_exhausted` (no runaway model calls); daily model-call cap enforced.
8. **G8 — approval:** ≥ 1 sensitive step paused, approved from the dashboard,
   resumed exactly (no duplicate side effects); ≥ 1 rejected (no mutation).
9. **G9 — recovery:** kill -9 the gateway mid-cycle; on restart the cycle
   resumes (stage log unchanged before the kill point) — verify script
   simulates this with a stale-cycle takeover.
10. **G10 — visibility:** for every completed cycle, `/loop/:id` shows the
    full saw→mattered→decided→did→result timeline with timestamps; the owner
    stream pushed stage events live.
11. **G11 — updates:** completed cycles wrote ≥ 1 memory record, touched the
    mission tree where relevant, and appended a `cycle.completed` CIN ledger
    record (chain still verifies).

`scripts/living-loop-verify.mjs` automates G3–G9 + G11 against real Mongo;
G1/G2/G10 are the live-demo portion (checklist printed by the script).

## 5. Gate status board (update on every verified change)

| Gate | Status | Evidence |
|---|---|---|
| G1 24h autonomous soak | **PENDING** | needs ≥24h, ≥10 unprompted cycles on owner machine |
| G2 real-model reasoning | **PASS** (2026-07-20, owner machine) | `cyc_1b21b2429e1e` — SIGNIFICANT (0.35), `high · model`, non-template rationale, real model + Atlas |
| G3 latency recorded | PASS (sandbox real-mongod 13/13) + observed live (p50/p95 ≈6322ms over 2 events) | `living-loop-verify.mjs`; owner /loop |
| G4 idempotency | PASS (sandbox real-mongod) | verify script + contract tests |
| G5 replay | PASS (sandbox real-mongod) | verify script + contract tests |
| G6 DLQ + requeue | PASS (sandbox real-mongod) | verify script + contract tests |
| G7 budget/fallback | PASS (sandbox real-mongod) | verify script + contract tests |
| G8 approval exact-resume | PASS (sandbox real-mongod) | verify script + contract tests |
| G9 restart recovery | PASS (sandbox real-mongod) | verify script + contract tests |
| G10 live visibility | **PASS** (2026-07-20, owner machine) | full observe→…→update timeline on `/loop` with real cycle |
| G11 memory+ledger updates | PASS (sandbox) + observed live | `mem_b7321f14555c`, CIN ledger anchor seq 11 |

**Owner-machine G3–G9/G11 re-run (recommended, one command):**
`node --import tsx scripts/living-loop-verify.mjs` with a throwaway
`MONGODB_DB_NAME` — belt-and-braces on the exact production driver/Atlas path.

**Known behavior (not bugs):** idle stack ⇒ tick `0/0/0` and empty `/loop`
(significance gate working); `system_notice` alone stops at assess (score <
0.25). To bootstrap a first significant cycle on a fresh database:
`scripts/loop-demo-seed.mjs`.

**CIN-3 unlock condition: G1 passes.** Everything else is green.

## 6. Honest boundaries

- The deterministic core runs without any LLM (kernel ethos); G2 is the only
  gate that REQUIRES a reachable model.
- In the build sandbox: no reachable model and no 24h process — G1/G2 are
  owner-machine gates. Everything else is testable here (contract tests) and
  against in-sandbox Mongo (verify script).
- Event Fabric sources wired in this slice: heartbeat proactive events +
  kernel event publisher + explicit POST. Connector-driven external events
  (email/calendar/…) attach through the same `ingestLoopEvent` seam later.
