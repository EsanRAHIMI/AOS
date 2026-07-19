# AOS — Current State (authoritative snapshot)

**This is the single fastest way to understand the repo without re-auditing.**
When it disagrees with older docs, this file + the code win. Keep it current.

_Last updated: 2026-07-19 · covers commits `ad8aa69` (D-177) → CIN-1 first slice (D-179)._

> **NEW NORTH STAR (2026-07-19):** the founder's **CIN v2** proposal
> (`docs/CIN v2.pdf`) is the adopted post-K2 direction — see
> `docs/cin-v2/master-plan.md` (phases CIN-1…CIN-6) and
> `docs/cin-v2/architecture.md`. CIN-1 (Trust & Identity Core) first slice is
> landed: `shared/src/cin/*` (entity graph + Ed25519 verifiable claims +
> hash-chained ledger), `/v1/cin/*` gateway routes,
> `scripts/cin-genesis-seed.mjs`, `shared/test/cin.contract.test.ts` (9 tests).

> **STATUS BANNER (read this):** **PRODUCT_VERIFIED = 0.** Nothing has been
> completed through the real dashboard browser with a real model yet. The build
> sandbox has **no reachable LLM** and **cannot launch a browser** (both
> BLOCKED_EXTERNAL — see §5). Everything below marked RUNTIME_VERIFIED was
> proven over **real Redis + real Mongo via HTTP/Node**, which is NOT the same
> as browser + real-model product proof. "RUNTIME_VERIFIED_EXTERNAL_INPUT"
> means real data was processed but supplied by the agent's external tools, not
> fetched by AOS itself.

---

## 1. Current commit / branches

- **`main` HEAD:** `58a189e` — dashboard RTL for Persian/Arabic.
- **K2 chain on main:** `ad8aa69` (D-177 core) → `759a5b0` (D-177b roles) →
  `7044220` (D-178a product activation) → `8376ded` (D-178a-fix) →
  `5bc4100` (D-178b self-dev ledger + docs) → `58a189e` (RTL).
- **Open branch (NOT merged, owner-gated):** `selfdev/mission-next-action`
  (`9e83de9`) — the real self-development run's code change (`computeNextAction`
  + briefing "next action" + Continue-in-Jarvis deep link). +165/−5, tested,
  awaiting owner merge approval.

## 2. Runtime topology

Local dev is a multi-service pnpm monorepo (no local Docker per project rule).
Deployables that matter for K2:

- **gateway-api** (Fastify, port 4101) — system of record + control plane +
  ALL `/v1/jarvis/*` routes; hosts the ONE agent loop in-process. Fail-soft on
  registry/event-bus being absent.
- **dashboard-web** (Next.js, port 3000) — the `/jarvis` workspace + owner home.
- **orchestrator-agent** (4102) + specialist agents — task pipeline (K1 queue).
- **Infra:** MongoDB Atlas (or any Mongo) + Redis (queue/pub-sub/rate-limits) +
  optional AWS S3. **Optional, self-hosted:** Ollama/vLLM (model), SearXNG (search).

Everything K2-Jarvis runs inside **gateway-api + dashboard-web + Mongo + Redis**.
No new deployable was added for K2 (agents/roles are logical actors, not services).

## 3. Implemented capabilities (what exists in code)

| Area | Where | Notes |
|---|---|---|
| Shared multi-turn agent loop | `shared/src/agentcore/loop.ts` | native tool calling, budgets (steps/wall-clock/tokens/cost), cancellation, explicit stop reasons, step traces, approval PAUSE + exact RESUME, untrusted-content fencing. Raw model text never mutates state. |
| Unified governed tool registry | `shared/src/agentcore/registry.ts` + `families.ts` | full policy surface; `available` is truth (unconfigured ⇒ `available:false`+reason); policy fails closed. ~22 tools; families: memory, missions, research, session, personal, system/tasks/code (injected). |
| Native providers + model registry | `shared/src/llm/toolcalling.ts` | Anthropic + OpenAI-compatible (Ollama/vLLM/LM Studio); tiers reasoning/standard/fast; no hardcoded model IDs; honest `none` degraded. |
| Specialist roles | `shared/src/agentcore/roles.ts` | versioned prompt + tier + grants + prohibitions + output contract (orchestrator, researcher, planner, reviewer, qa, chief_of_staff, reflection). Prompted actors, not services. |
| Persistent Jarvis sessions | `shared/src/jarvis/session.ts` | durable sessions/turns, rolling summary, pinned facts, transcript context, compaction. |
| Jarvis turn runner | `shared/src/jarvis/turn-runner.ts` | ONE path per turn: assemble context → loop → persist → degraded-honest fallback. |
| Memory v2 | `shared/src/memory2/index.ts` | kinds+status (confirmed/inferred/temporary)+provenance; hybrid bilingual (FA/EN) lexical retrieval always; optional local vector; correct/pin/delete; supersede; decay. `listMemories` excludes superseded by default. |
| Mission hierarchy | `shared/src/missions/index.ts` | vision→objective→program→mission→plan→task→action; parent-type integrity; duplicate guard; stall/overdue; `buildMissionContext`. (`computeNextAction` is on the self-dev branch only.) |
| Personal operating state | `shared/src/personal2/index.ts` | snapshot over Memory v2 + missions; deterministic onboarding (explicit answers → confirmed records + seed vision). No new architecture. |
| Independent research | `shared/src/research/providers.ts` + `research/index.ts` | SearXNG/direct/RSS/sitemap; robots-aware; provenance ledger (pub+retrieval dates); dedup/cache; Tavily optional-only. |
| Owner briefing v2 + watches | `shared/src/watches/index.ts` | grounded in real mission health + decisions/opportunities; dedup watches; honest-empty. |
| Self-development pipeline | `shared/src/selfdev/index.ts` | durable state machine with approval-before-implement + verify-before-merge gates. |
| Streaming + approval UI | `services/dashboard-web/src/app/jarvis/` + `api/jarvis-stream` | SSE turn stream, tool steps, inline approval cards, memory tab, RTL. |
| CIN-1 Trust & Identity Core (D-179) | `shared/src/cin/` + `routes/cin.ts` | living entity graph (10 types, versioned/visibility-scoped sections, typed relations), Ed25519 verifiable claims (issue/verify/expire/revoke, selective-disclosure hash), tamper-evident hash-chained ledger; genesis seed script. CODE_COMPLETE + contract-tested (fake-db); real-Mongo genesis run pending on owner infra. |

## 4. Verification status (status vocabulary is exact)

| Capability | Status | Evidence |
|---|---|---|
| Agent loop (multi-turn, budgets, cancel, resume, fencing) | RUNTIME_VERIFIED | `shared/test/agentcore.contract.test.ts` + `scripts/jarvis-runtime-verify.mjs` 8/8 (real Redis+Mongo+local server) |
| Memory v2 incl. cross-session recall | RUNTIME_VERIFIED | `memory2.contract.test.ts`; runtime-verify checks 1–3 |
| Persistent sessions/turns + reload continuity | RUNTIME_VERIFIED | runtime-verify check 3; `jarvis-product-scenarios.mjs` A3 |
| Personal state + deterministic onboarding | RUNTIME_VERIFIED | `personal2.contract.test.ts`; product-scenarios A1–A4 (12/12, live gateway) |
| Owner briefing grounded in real state | RUNTIME_VERIFIED | product-scenarios E1–E2 |
| Approval pause + EXACT resume (mechanism) | RUNTIME_VERIFIED | runtime-verify check 5 (real infra) |
| Unified tool registry + availability truth | RUNTIME_VERIFIED | `jarvis-http-verify.mjs` (9/9), product-scenarios F1 |
| Model provider WIRE (OpenAI-compatible/Anthropic) | CODE_COMPLETE | `toolcalling.integration.test.ts` (real HTTP wire, mock server) + skip-gated real-endpoint check. Wire only — NOT reasoning. |
| Real self-development run (branch/diff/tests/build) | RUNTIME_VERIFIED | branch `9e83de9` (+165/−5), typecheck (caught a bug), 5 tests + suite, build; `selfdev-record-run.mjs` 5/5 |
| Independent research **pipeline** (extract/provenance/dedup/→mission) | RUNTIME_VERIFIED_EXTERNAL_INPUT | `research-real-sources-verify.mjs` 8/8 vs real Mongo. **Honesty:** the source CONTENT was fetched by the AGENT'S OWN external web tools (not AOS's own SearXNG/fetch tools) and injected into the production pipeline. This proves extract→provenance→dedup→memory→mission on REAL sources, but does **NOT** prove AOS can research independently. See below. |
| **AOS-native research (its own tools fetch the web)** | **BLOCKED_EXTERNAL** | the sandbox allowlist blocks the research module's own outbound `fetch`; SearXNG not deployed. Needs a networked env / SearXNG. |
| Personal onboarding UI in `/jarvis` | CODE_COMPLETE | first-run panel wired to `/onboarding` + `/personal-state`; **not** browser-verified |
| **Real model REASONING (quality)** | **BLOCKED_EXTERNAL** | no reachable model in the sandbox; only `api.anthropic.com` host reachable, no key. See §5. |
| Browser LAUNCH (real Chromium headless) | RUNTIME_VERIFIED | D-178d — real Chromium 149 launches + renders + screenshots via `e2e/sandbox-libs/build-xdamage-stub.sh` (stubs the one missing lib, no root). |
| **Real-browser `/jarvis` full E2E (login→session→stream→approval→resume→cancel)** | **BLOCKED_EXTERNAL** | Browser now launches; blocked by (a) no real model, and (b) THIS sandbox can't build/serve the Next.js dashboard within its 45s process-lifetime limit. `e2e/jarvis.spec.ts` + `playwright.config.ts` run with one command on a normal machine. |
| Deployment to a real domain | not attempted | no owner infra changes made |

### Runtime/HTTP verification is NOT browser verification — explicit separation

- **RUNTIME_VERIFIED here means:** exercised against **real Redis + real
  MongoDB via HTTP/Node** (the four verify scripts + contract suites). It does
  **NOT** mean the flow was driven through the dashboard UI in a real browser.
- **PRODUCT_VERIFIED count is currently ZERO.** No scenario has been completed
  through the real browser with a real model. Any earlier wording implying
  otherwise is corrected here.
- **The mock/scripted OpenAI-compatible server** inside `jarvis-runtime-verify.mjs`
  and `toolcalling.integration.test.ts` proves only the **wire + mechanism**
  (tool-call serialization, observation threading, pause/resume). It is
  explicitly **NOT** evidence of reasoning quality and is never counted as
  product proof.

**Verified against real Mongo + real Redis via HTTP/Node (not browser, not FakeDB):**
`scripts/jarvis-runtime-verify.mjs` (8/8), `scripts/jarvis-http-verify.mjs`
(9/9), `scripts/jarvis-product-scenarios.mjs` (12/12),
`scripts/research-real-sources-verify.mjs` (8/8, externally-fetched sources),
`scripts/selfdev-record-run.mjs` (5/5), plus the K1 queue verifiers (16/16).

**Automated test counts (current main):** shared **233 passed / 1 skipped**
(the skipped one is the `LLM_VERIFY_BASE_URL` real-endpoint gate); gateway-api
**254 passed**; typecheck clean; `check-scope-boundary` clean.

## 5. Known limitations / why some tools are unavailable

- **No reachable model in the build sandbox.** Every model-weight host
  (HuggingFace, Ollama registry, jsdelivr, GitHub LFS/release-assets) and every
  inference endpoint EXCEPT `api.anthropic.com` is blocked by the sandbox
  allowlist; no `ANTHROPIC_API_KEY` is set. So autonomous reasoning was not run
  here. The provider code path is real and health-checked.
- **Browser LAUNCH is now solved (D-178d)** — real Chromium 149 runs headless
  via the `libXdamage.so.1` stub (`e2e/sandbox-libs/build-xdamage-stub.sh`). The
  remaining browser gap is that THIS sandbox cannot build/serve the Next.js
  dashboard within its 45s per-call process-lifetime limit (builds don't resume,
  processes die between calls). Not a code defect; a non-issue on a normal
  machine. Chromium's SWC-for-Next detail: the linux-arm64 `@next/swc` binary
  must be present (node_modules installed on macOS lacks it) —
  `npm i @next/swc-linux-arm64-gnu@<nextver>` fixes it.
- **Injected tools report `available:false` when their dep isn't bound:**
  `system_service_health`, `task_create`, `code_*`, `personal_snapshot`
  (legacy) require the hosting process to bind them; a bare gateway boot shows
  16/22 available, which is correct/honest, not a bug.
- **Research module's own Node fetch** can't reach arbitrary public sources from
  the sandbox (allowlist) — works in a normal deployment.

## 6. Unfinished product flows (need §5 unblocked)

- Model-driven autonomous multi-turn tool use in `/jarvis` (needs a real model).
- Pixel-level `/jarvis` browser interaction (needs the browser lib).
- Live web research synthesis into cited reports (needs egress + a model).
- The full self-development loop *initiated through Jarvis by a model* (the
  engineering pipeline is real; the model-driven decision step needs a model).

## 7. Next milestone — the exact external blocker (stop condition)

To reach PRODUCT_VERIFIED, exactly one owner action is required:

**BLOCKER:** no reachable LLM in the build sandbox (every model host + weight
CDN blocked; only `api.anthropic.com` reachable, no key).

**ONE VALUE TO PROVIDE (either):**
- `LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1` (+ `ollama pull qwen2.5:7b`), or
- `ANTHROPIC_API_KEY=sk-ant-…`

**VERIFIED IMMEDIATELY AFTER (already scripted, will run without further code):**
`node scripts/model-health-check.mjs` → a genuine generated response; then on a
machine that can serve the dashboard (any normal Linux/macOS), the
`e2e/jarvis.spec.ts` suite drives the real browser through: login → `/jarvis` →
Persian turn → **real streaming + real tool call + observation + second
reasoning turn** → reload continuity → approval card → approve+resume →
reject (no mutation) → cancel. The browser itself already launches here
(D-178d); only the model + a servable dashboard remain.

## 8. Exact commands to run and verify

```bash
# 0) prerequisites (owner machine): Node 22, pnpm 9, a running Mongo + Redis.
pnpm install
pnpm run build:deps                      # shared + service-kit

# 1) real local model (recommended, no paid API)
#    install Ollama, then:
ollama serve &
ollama pull qwen2.5:7b                    # any tool-capable model
export LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1
export LLM_LOCAL_MODEL=qwen2.5:7b
node scripts/model-health-check.mjs       # expect provider=openai-compatible, probe.ok=true

# 2) run the stack
pnpm --filter @factory/gateway-api dev    # :4101  (set MONGODB_URI, REDIS_URL, LLM_LOCAL_*)
pnpm --filter @factory/dashboard-web dev  # :3000  (FACTORY_API_URL=http://127.0.0.1:4101)

# 3) automated verification (real Redis + real Mongo)
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @factory/shared test         # 233 pass / 1 skipped
REDIS_URL=redis://127.0.0.1:6379 pnpm --filter @factory/gateway-api test    # 254 pass
REDIS_URL=... MONGODB_URI=... node scripts/jarvis-runtime-verify.mjs        # 8/8
AOS_ROOT=$(pwd) REDIS_URL=... MONGODB_URI=... node scripts/jarvis-http-verify.mjs        # 9/9
AOS_ROOT=$(pwd) REDIS_URL=... MONGODB_URI=... node scripts/jarvis-product-scenarios.mjs  # 12/12

# 4) real browser (needs chromium system libs)
npx playwright install --with-deps chromium
BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/jarvis.spec.ts

# 5) optional self-hosted search
#    deploy SearXNG (deployment/searxng.md) then:
export SEARXNG_BASE_URL=http://127.0.0.1:8080
```

Open **http://localhost:3000/jarvis** → New thread → type Persian → send.
Owner home shows the briefing. Memory tab inspects/corrects memories.
