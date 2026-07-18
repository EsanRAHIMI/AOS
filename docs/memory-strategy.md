# Memory & Learning Strategy

Memory is AOS's long-term operating context. It must help future agents act
faster, ask fewer repeated questions, and align with the correct user, tenant,
role, and policy context.

> **AS-BUILT (K2, D-177/D-178) — this is the live system.** The sections below
> under "Legacy direction" describe the earlier, still-valid intent. The live
> implementation is **Memory v2** in `shared/src/memory2/index.ts`, and it is
> what Jarvis actually reads and writes today.

## Memory v2 — as built (`shared/src/memory2`)

ONE scoped collection **`memory_records`** holds every memory as
`{ kind, status, content, subject, provenance, importance, confidence, pinned,
lastConfirmedAt, supersededBy, deletedAt }` + scope fields.

- **Kinds:** `fact, preference, commitment, decision, goal, person, project,
  research, lesson, skill, context, note, opportunity, risk, deadline`.
- **Status (the three layers the mandate requires):** `confirmed` (owner
  stated/approved), `inferred` (model concluded), `temporary` (conversation
  context that decays).
- **Provenance:** `sourceType` (`user_stated | user_corrected | jarvis_inferred
  | research | reflection | system`) + session/turn/run ids + refIds + sourceUrl.
- **Retrieval is HYBRID and offline-first:** bilingual (FA/EN) lexical scoring
  (`lexicalScores`, Persian ی/ي + ک/ك normalization, ZWNJ split, stopwords)
  always works with zero dependencies. A **local** embedding provider
  (`embeddingProviderFromEnv`: Ollama / any OpenAI-compatible `/embeddings`,
  vectors stored in Mongo `memory_embeddings`) is blended in when configured —
  never a paid hosted vector DB. `buildMemoryContext` is the provenance-carrying,
  token-budgeted packet Jarvis reads each turn.
- **Cross-session recall (proven):** a fact recorded in session A is retrieved
  and grounds the answer in a NEW session B. Proof:
  `shared/test/memory2.contract.test.ts` + `scripts/jarvis-runtime-verify.mjs`
  (checks 1–3, real Redis+Mongo).
- **Owner control:** `correctMemory` (→ confirmed, drops stale vector),
  `pinMemory`, `deleteMemory` (tombstone + embedding removal). HTTP:
  `/v1/jarvis/memories`, `/memories/:id/{correct,pin,delete}`.
- **Contradiction + decay:** a newer confirmed record on the same `subject`
  **supersedes** the old (`supersededBy`); `listMemories` excludes superseded by
  default so current state never double-counts (bug found by the D-178 live
  scenarios). `decayStaleMemories` expires temporary facts and decays unconfirmed
  inferences.
- **Reflection lessons** (kind `lesson`) are written after significant runs and
  after a successful self-development verification.

Legacy compact-memory types (`jarvis_memory_facts`, maintenance/summary runs)
remain for the older daily-brain path and are being superseded by Memory v2.

---

## Legacy direction (pre-K2, still-valid intent)

### Current Memory Types

`task`, `decision`, `architecture`, `error`, `solution`, `user_preference`,
`service`, `deployment`, `research`, `skill`.

## Current Loop

After meaningful work, the system should record:

- What was done.
- What worked.
- What failed.
- What evidence exists.
- What future agents should reuse.
- What docs should change.

These become compact memories, skill candidates, reliability scores, patterns,
recommendations, and compressed contexts.

## Next Memory Layer: User and Tenant Context

Add durable, scoped memory:

- User profile: name style, timezone, languages, communication preference.
- Tenant profile: personal, team, company, government department, or public-service unit.
- Goals: personal, career, business, learning, finance, civic, organizational, project.
- Constraints: budget, time, risk tolerance, deadlines, commitments, legal/policy limits.
- Assets: resume, portfolio, GitHub, domains, products, documents, approved records.
- Preferences: decision style, notification style, approval thresholds.
- Relationships: contacts, organizations, departments, and cases, only with permission.

## Memory Quality Rules

- Never store secrets.
- Mark source and confidence.
- Separate facts, preferences, inferences, and temporary context.
- Allow user correction/deletion where policy permits.
- Scope every memory to `global`, `tenant`, `user`, `role`, `project`, or `case`.
- Summarize aggressively; keep raw logs only when useful for audit/evidence.
- Do not let stale memories silently override current authorized instructions.

## Future Learning Direction

- Daily briefings should write summary memory.
- Weekly strategy reviews should update goals and priorities.
- Opportunity analysis should record outcomes: accepted, rejected, profitable, failed.
- Public-service workflows should record case outcomes without leaking cross-user data.
- Prompt/model performance should drive provider and prompt recommendations.
- No fine-tuning until the dataset is clean, consented, deduplicated, and useful.

## Phase AB — personal decision learning
Every next-best-action decision writes a scoped memory: accept/complete →
`decision` (“similar suggestions are valuable”), reject → `mistake_avoidance`
(“deprioritize similar suggestions”). Briefing and strategy runs persist as
scoped runs with sourcesUsed / sourcesNotConfigured, so future agents know what
data actually informed each recommendation. All of it stays user-scoped unless
explicitly global.
