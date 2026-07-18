# Jarvis Specification (K2 — D-177)

**Status:** live. Implements master-direction §G and the K2 mandate. This
document is the source of truth for how Jarvis behaves; keep it in sync with
`shared/src/jarvis`, `shared/src/agentcore`, and `services/gateway-api/src/routes/jarvis.ts`.

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
