# Jarvis Specification (K2 — D-177)

**Status:** live. Implements master-direction §G and the K2 mandate. This
document is the source of truth for how Jarvis behaves; keep it in sync with
`shared/src/jarvis`, `shared/src/agentcore`, and `services/gateway-api/src/routes/jarvis.ts`.

## ONE assistant (D-184)

The dashboard used to run **two** different chat surfaces:

| surface | engine | verdict |
|---|---|---|
| `OperatorConsole` (floating, every page) | `/v1/operator/*` — deterministic goal→tool-step mapping, its own session model, plus the `/v1/voice/*` path | **removed** |
| `/jarvis` stage command bar | `/v1/jarvis/*` — the K2 shared multi-turn agent loop, governed tool registry, Memory v2, missions, approval pause/resume | **kept** |

Two assistants meant two memories, two histories and two behaviours for the
same question. There is now exactly one agent, on two surfaces:

- **`JarvisDock`** (`components/JarvisDock.tsx`) — mounted once in
  `app/layout.tsx`, so it is available on every page and its state survives
  navigation. Collapsed it shows the real briefing priority; expanded it is a
  conversation with **live tool steps**, inline **approvals**, and the current
  pathname passed as context so "open this" means the right thing on the page
  you are on. `⌘K` / `Ctrl+K` toggles it; `Esc` closes.
- **`/jarvis` stage** — the same agent full-screen, with the board. The dock
  hides itself there so a page never shows two inputs.

Both call the same server actions (`app/jarvis/actions.ts`) and the same
streaming route (`/api/jarvis-stream`), and both resolve the same session, so
a conversation started on the stage continues in the dock on any other page,
with the same memory.

**Removed with the console:** `hooks/useRealtimeVoiceSession.ts` (its only
consumer), and the `op-working-bar` / `op-mono` / `op-sweep` CSS. Kept
deliberately: `app/operator/actions.ts` (the homepage still uses
`getLiveStateAction`), the `/voice` pages (a read-only archive of the legacy
pipeline's recorded sessions — their copy now points at Jarvis), and every
gateway route, which is kernel surface and out of scope for a UI change.

## 1. What Jarvis is

Jarvis is the persistent command intelligence between the owner and the OS —
a **session engine + context assembler + governed tool loop + presence
layer**, not a chatbot widget. Every other surface is a view; Jarvis is the
hand and voice of the system.

The ONE shared multi-turn agent runtime (`shared/src/agentcore/loop.ts`)
powers Jarvis and every agent role. The old single-shot `generateStructured`
Jarvis path (`shared/src/jarvis/index.ts`) remains only as the **degraded
composer** used when no model provider is configured — it is never a
co-equal reasoning path.

## 2. Durable objects

| Object | Collection | Purpose |
|---|---|---|
| `JarvisSession` | `jarvis_sessions` | Long-lived thread: rolling summary, pinned facts, active mission links, cost. Survives reloads/restarts. |
| `JarvisSessionTurn` | `jarvis_session_turns` | One user input → assembled context → loop run → streamed reply + structured extract. |
| `AgentLoopRun` | `agent_loop_runs` | The persisted model conversation + pending tool call — THE exact-resume state. |
| `AgentLoopStep` | `agent_loop_steps` | Step-level trace (model_turn / tool_execution / approval_pause / approval_resume). |
| `ToolInvocation` | `tool_invocations` | One ledger for every tool call: request → policy decision → result → evidence. |
| `ApprovalCheckpoint` | `agent_approval_checkpoints` | In-conversation approval card; pauses the exact run. |
| `MemoryRecord` | `memory_records` | Memory v2 (see memory-strategy.md). |
| `MissionNode` | `mission_nodes` | Objective hierarchy (see domain-framework.md). |
| `RetrievedSource` | `research_sources` | Research provenance ledger. |

## 3. The turn pipeline (`shared/src/jarvis/turn-runner.ts`)

```
input (text|voice)
  → beginTurn (persist)
  → assembleTurnContext:
        transcript (rolling summary + pinned + recent turns, token-budgeted)
      + memory v2 (scope-filtered hybrid retrieval, provenance-tagged)
      + active mission hierarchy (upward linkage)
      + honest system/research status
  → startAgentLoop (native tool calling; structured compat fallback; else degraded)
        model turn → governed tool request → policy gate → execute OR pause-for-approval
        → observation fed back → replan … until final answer / budget / cancel
  → completeTurn (persist reply, stop reason, cost, used memory ids)
  → compactSession (fold old turns into the rolling summary past budget)
```

Budgets per turn: max steps (default 8), wall-clock timeout (120s), token and
cost budgets. Cancellation is honored between steps. Every stop has an explicit
reason (`completed`, `max_steps`, `timeout`, `budget_cost`, `budget_tokens`,
`cancelled`, `waiting_approval`, `model_error`, `no_model`).

## 4. Governance invariants (never weakened)

1. **Raw model text never mutates state.** The only mutation path is a governed
   tool executor behind the unified registry (`shared/src/agentcore/registry.ts`),
   gated by `evaluateToolRequest`.
2. **Read auto-executes within scope; sensitive pauses for approval.** Policy
   categories: `read_only`/`internal_reversible` auto-allow; everything
   sensitive (`internal_sensitive`, `external_action`, `destructive`,
   `financial`, `production`, `protected_core`) pauses. Safe mode blocks all
   mutations. A sensitive category without an explicit `requiresApproval:true`
   fails **closed**.
3. **In-conversation approval → exact resume.** A paused run persists an
   `ApprovalCheckpoint` + `pendingToolCall`; approval executes that exact tool
   and continues the same conversation. Rejection is observed by the model,
   which replans. Proven to survive a process restart (contract test + runtime
   scenario).
4. **Untrusted web content is fenced as data.** Tools with
   `outputTrust: 'untrusted_external'` have their output wrapped in a
   non-instruction fence before any model sees it — web pages can never issue
   tool calls (prompt-injection defense).

## 5. Independence & honesty

- **Model:** `modelRegistryFromEnv` resolves, in priority order,
  `LLM_LOCAL_BASE_URL` (Ollama/vLLM/any OpenAI-compatible self-hosted
  endpoint) → `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `none` (degraded). No
  company or model is hardcoded; tiers (`reasoning`/`standard`/`fast`) are
  configurable via `LLM_MODEL_*`.
- **Degraded mode is honest.** With no provider, a turn completes from real
  stored data via the deterministic composer, labeled `reasoningMode:'none'`
  and visibly flagged in the UI. Personal state, memory, missions and
  deterministic tools keep working (offline mandate).
- **Research is self-hostable.** SearXNG preferred; direct fetch/RSS/sitemap
  always work; Tavily is optional, never required. See domain-framework.md §
  Research.

## 6. HTTP surface (`/v1/jarvis/*`) — as built (17 routes)

Sessions: `POST/GET /sessions`, `GET /sessions/:id`. Turns:
`POST /sessions/:id/turns` (`?stream=1` for SSE). Runs: `GET /runs/:runId`,
`POST /runs/:runId/cancel`. Approvals: `POST /loop-approvals/:id/decision`
(resumes the exact run). Registry: `GET /tools`. Memory:
`GET /memories`, `POST /memories/:id/{correct,pin,delete}`. Status:
`GET /intelligence-status`. Roles: `GET /roles`.

**D-178 additions (Product Activation):**
- `GET /personal-state` — owner operating-state snapshot (Memory v2 + missions).
- `GET /onboarding/questions`, `POST /onboarding` — deterministic onboarding
  (explicit answers → confirmed records + seed vision; nothing fabricated).
- `GET /owner-briefing?lang=fa|en` — grounded in real mission health + recorded
  decisions/opportunities + pending approvals + self-dev proposals.

## 7. Verification (D-177 + D-178) — current

- Contract tests: `agentcore` (loop/governance/resume/injection/budgets),
  `memory2` (cross-session recall), `missions`, `research-stack`,
  `watches-selfdev`, `personal2`, `toolcalling.integration` (real HTTP wire).
  Shared **233 pass / 1 skipped**; gateway **254 pass**.
- Runtime (real Redis + real Mongo + a real local OpenAI-compatible server):
  `scripts/jarvis-runtime-verify.mjs` **8/8**.
- HTTP product tier (real gateway process): `scripts/jarvis-http-verify.mjs`
  **9/9**; `scripts/jarvis-product-scenarios.mjs` **12/12**.
- Self-development durable ledger: `scripts/selfdev-record-run.mjs` **5/5**
  (real branch `selfdev/mission-next-action`, gates enforced, not merged).
- **Model reasoning quality** and **real-browser `/jarvis`** are
  **BLOCKED_EXTERNAL** in the build sandbox — see `docs/current-state.md` §5.
  The mock model in the runtime verifier proves the *wire/mechanism only*, never
  reasoning.

## 8. Model provider (independence)

`modelRegistryFromEnv` (`shared/src/llm/toolcalling.ts`) resolves, in order:
`LLM_LOCAL_BASE_URL` (Ollama/vLLM/LM Studio) → `ANTHROPIC_API_KEY` →
`OPENAI_API_KEY` → `none` (honest degraded). Tiers `reasoning/standard/fast`
via `LLM_MODEL_*`; no hardcoded model IDs. Health check:
`node scripts/model-health-check.mjs`. Missing cloud keys never disable
personal state, memory, missions, or local tools.

## 9. The happening stage (D-208)

`/jarvis` is no longer only a presence visual. Above the board and the
singularity sits the **happening layer**: one card per thing that actually
happened, animated into a tree.

### The feed is a projection

`shared/src/happenings/index.ts` derives the feed from rows the kernel already
writes under governance — it has **no write path of its own**:

| source collection | becomes |
|---|---|
| `jarvis_session_turns` | `owner_said` (root) + `jarvis_replied` (child of it) |
| `tool_invocations` | `tool_ran` / `tool_blocked`, child of the turn via `runId → turnId` |
| `agent_approval_checkpoints` | `approval`, child of the turn |
| `proactive_events` | `noticed` (root) |
| `loop_cycles` | `loop_cycle` (root) |

A card exists **iff** its governed row exists. A tool call with no run is an
autonomous action and stays a root, because that is the card most worth
noticing.

Categories are the owner's words, not module names — `calendar`, `tasks`,
`memory`, `personal`, `knowledge`, `trust`, `system`, `dialogue` — mapped from
tool-name prefixes, so a new tool needs no table entry and an unmapped one
shows as `system` rather than being dropped.

### The three places a card can be

1. **Focus** — it just happened; full size, centre stage.
2. **Flight** — dwell expired; it animates to its destination, measured with
   `getBoundingClientRect` at departure so it lands correctly after any reflow.
3. **Settled** — nested under its parent card, or in its category pile.

Dwell is `3.2s + 5.2s × weight`. **A card with `status:'waiting'` (a pending
approval, weight 1) never departs on its own** — the system is stopped on a
human and the animation must not carry that away. With
`prefers-reduced-motion`, cards appear directly in their settled place.

### Transport

`GET /v1/jarvis/happenings?afterIso=&limit=&categories=` for polling, and two
frames on the existing owner SSE (`/v1/stream/owner`):

- `happenings.snapshot` — the backlog as ONE frame; renders settled, so a
  reconnect never replays the last hour as news.
- `happening` — one new card, animated.

The incremental cursor is **inclusive** (`$gte`): a turn and its first tool
call routinely share a millisecond, and an exclusive cursor silently dropped
one of them. Clients dedupe on `happeningId`, which is derived from the source
row and therefore stable across reconnects. At equal timestamps roots sort
ahead of children, so a child is never briefly rendered as a root.

## 10. Readiness gaps (D-208)

`GET /v1/jarvis/readiness` — what the **owner** has not supplied yet, one line
each. Distinct from `capability_gaps`, which is what the **kernel** lacked
while doing its own work; that one is fixed by writing code, this one by
connecting an account or answering a question.

Every gap carries a `consequence` (what the system cannot do while it exists)
and exactly one `action` with an `href`. Checks are grounded in real absent
state and **silent when satisfied** — the healthy output is `[]`. Current
checks: model provider, calendar (not connected / not synced / all disabled —
three distinct states with three distinct fixes), no missions, empty memory,
unconfirmed preferences.

Rendered pinned to the top of the settled column on `/jarvis`, above the
scrolling history: a standing condition that scrolled away is a condition
nobody ever fixes.

## 11. Presence — the attention gate (D-209)

Jarvis may say something true at a moment that makes saying it wrong. Every
unprompted utterance passes `shared/src/presence/attention.ts` first.

`decideInterrupt(candidate, ctx)` is pure and returns one of four verdicts
with a reason:

| verdict | meaning |
|---|---|
| `speak_now` | say it aloud |
| `card_only` | show it on the stage, no voice |
| `hold_for_briefing` | deliver at the next natural moment |
| `suppress` | **never returned** — see below |

Inputs: the owner's live calendar state (`in_meeting`), waking hours in their
own timezone (`quiet_hours`), whether they are typing to Jarvis (`focused`),
the item's weight (reused from the D-208 happening feed, never re-derived),
whether delay destroys its value (`timeCritical`), and how recently Jarvis
last spoke (`SPEAK_COOLDOWN_MS`, 8 min, bypassed by time-critical items).

**Invariants**

- **`suppress` is never produced**, and a contract test asserts it across
  every state × weight × urgency combination. Silence is a decision about
  delivery, not about whether the owner gets to know.
- **`unknown` ≠ `free`.** An unreadable calendar means possibly-busy.
- **`focused` outranks urgency.** Nothing is worth talking over the owner
  mid-sentence.
- Every verdict is written to `attention_decisions` with its reason and state.
  That ledger is the only answer to *"why did you not tell me?"*

`GET /v1/jarvis/attention` returns the current context, recent decisions and
held items. `POST /v1/jarvis/attention/judge` lets the browser ask the same
gate rather than keeping a private rule about when it may talk.

### Briefing moments

`shared/src/presence/briefing-moments.ts`. Held items are delivered at one of
three moments in the owner's own day: **morning** (first waking hour),
**gap** (a real opening between calendar events, ≥ `MIN_GAP_MINUTES` = 25),
**evening** (last waking hour). Morning and evening take precedence over a gap
inside the same hour.

`deliverBriefingIfDue` is idempotent — the pulse runs every five minutes, so
anything else would deliver the morning briefing twelve times. The moment is
recorded before its items are marked delivered: a crash between the two writes
repeats an item rather than losing it.

Waking hours (07:00–23:00) are intentionally not a preference — the failure
mode of a wrong value is being woken up. The timezone is the one already
confirmed in D-202.

## 12. Ambient voice (D-209)

`services/dashboard-web/src/lib/useAmbientVoice.ts` — continuous recognition
with a wake word, separate from `useVoice` (push-to-talk) because it is a
different machine with different failure modes.

- **Wake word**: `WAKE_WORDS` accepts several Persian spellings plus Latin
  forms; matching folds Arabic yeh/kaf, harakat and ZWNJ. The command is the
  text that FOLLOWS the wake word in the same utterance, returned **verbatim**
  — `fold()` keeps an index map so the split survives normalisation and the
  owner's exact words reach the model.
- **The utterance is REBUILT, never appended (D-210).** `interimResults`
  re-delivers the same result index with a longer transcript on every event,
  so appending yields every prefix of the sentence concatenated. The results
  list is the utterance: `utteranceFrom(results, base)` derives the command
  fresh each event and is idempotent. `base` skips results already submitted —
  the browser does not clear the list on submit.
- **One recogniser, always.** The stop flag is a closure variable local to each
  effect run, not a shared ref: with a ref, a StrictMode remount left the
  previous recogniser alive and one spoken sentence became two turns. A 4s
  duplicate window on identical text covers the remaining races.
- **Privacy**: Chrome's SpeechRecognition uploads audio. Ambient mode is off
  by default, **never persisted**, and its `disclosure` string is rendered
  beside the switch. Everything heard before the wake word is discarded in the
  browser — not stored, not rendered, not sent.
- **Barge-in**: speech detected while Jarvis is speaking cancels the utterance.
- Commands enter through `JarvisConversation`'s `injected={{ text, nonce }}`
  prop — the nonce is what lets the owner repeat the same command twice.


## 13. Vague times are answers, not questions (D-210)

`calendar_find_free_slot(fromIso, toIso, durationMinutes?)` returns real
openings computed against the mirror. All-day events are excluded — treating
"on leave" as a 24-hour block reports every evening as busy.

The prompt rule `VAGUE TIMES — decide, act, then report` requires Jarvis to
resolve "tonight" / "tomorrow morning" against RIGHT NOW, call this tool, take
the **first** free slot, create the event in the same turn, and state the time
it chose so the owner can correct it in three words.

Defaults, so nothing has to be asked: morning 09:00–12:00, afternoon
13:00–17:00, evening 18:00–22:00 (owner's timezone); 60 minutes, or 30 for a
call or quick errand.

Asking is reserved for what cannot be derived and is expensive to get wrong:
who to invite, which of two real conflicting events to move, an amount of
money. **Never** a time, a duration or a calendar. A full window is still an
answer — report the clash and propose the nearest alternative.

## 14. The turn engine (D-211)

`services/dashboard-web/src/lib/jarvisEngine.ts` — module-scope state that
lives for the tab's lifetime. **The conversation is a process; views observe
it.** `JarvisConversation` subscribes and may mount/unmount freely.

Entry point is `submit(text, { transport, contextNote })` for every source —
text box, dictation, wake word. It returns `false` when rejected.

**Guarantees**

- **Serial.** One turn at a time, queued in order. Turns share one server-side
  session and rolling summary, so concurrent runs have no defined meaning —
  they were the cause of the same question being answered "2 events" and then
  "1 event".
- **Deduped.** An identical command inside 6s, or one already in the queue, is
  rejected. Queue capped at 5; a command that waited >90s is dropped as stale
  rather than acted on silently.
- **View-independent.** A turn started with the panel open completes with it
  closed. Nothing about panel state changes behaviour.
- **The speaker is lent, not owned.** `setSpeaker()` — the engine outlives
  every surface, and a voice still talking after its surface is gone cannot be
  silenced.

Voice never reaches the pipeline through a prop. The old
`injected={{text, nonce}}` path re-fired its effect on remount, which is how
one spoken sentence became four turns.

## 15. Provider resilience (D-211)

`shared/src/llm/resilience.ts` wraps both providers.

- Retries **429 / 408 / 5xx** and network drops, up to `MAX_ATTEMPTS` (4).
- Waits the provider's own hint: `Retry-After` header, else the
  "Please try again in 11.242s" sentence in the body (TPM limits often carry
  no header). Always jittered; capped at `MAX_BACKOFF_MS` (20s).
- **Never retries** other 4xx — the request will be wrong again and retrying
  burns the scarce budget. An abort outranks a pending backoff.

**Errors the owner sees are sentences.** `run.error` keeps the precise
provider failure (status + truncated body) for diagnosis; `run.errorHuman`
carries the owner-facing text. The raw 429 body contains the organisation id,
model name and token accounting and must never reach a conversation.
`stopReasonSentence()` does the same for stop reasons.
