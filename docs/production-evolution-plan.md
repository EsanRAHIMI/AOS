# AOS Production Evolution Plan

Status: active  
Principle: evolve existing production paths; do not create parallel platforms.

## Operating rules

- Every phase has a measurable user or operational outcome.
- Characterization tests protect existing behavior before consolidation.
- New services require an independent scaling, failure, or security boundary.
- Every production change needs health evidence and a rollback path.
- Model quality is accepted through AOS scenarios, not vendor benchmarks alone.
- No autonomous action bypasses policy, approval, audit, or post-action verification.

## Phase 1 - One model boundary

Outcome: every text reasoning path can use the existing local-first configuration.

- Reuse `LLM_LOCAL_*` and `LLM_MODEL_*` across native tool calling and structured generation.
- Keep Anthropic, OpenAI, and deterministic fallback behavior compatible.
- Record local inference honestly as provider `local` with zero API cost.
- Prove the OpenAI-compatible wire with contract tests.

Acceptance:

- A configured local endpoint takes priority over cloud keys.
- Both tool calling and structured generation reach `/v1/chat/completions`.
- Invalid structured output still cannot escape schema validation.
- Typecheck, shared contracts, and existing service tests remain green.

Rollback: remove `LLM_LOCAL_BASE_URL`; cloud/fallback resolution remains unchanged.

## Phase 2 - AOS evaluation gate (implemented)

Outcome: model or prompt changes cannot ship without measured product quality.

- Version a representative Persian/English scenario corpus.
- Score tool selection, argument validity, groundedness, recovery, latency, and cost.
- Separate deterministic contract checks from model-quality evaluations.
- Establish release thresholds and regression reports per model version.

Evidence: `evaluations/model-gate.v1.json`, `shared/src/evaluation/model-gate.ts`,
and `scripts/model-evaluation-gate.mjs`. Runtime quality remains unverified until
the suite runs against the selected real model on production-equivalent GPU
hardware; implementation completion is not a model-quality claim.

## Phase 3 - Governed autonomy

Outcome: every action is risk-classified, authorized, reversible where possible,
and verified after execution.

- Extend the existing policy and approval paths; do not build a second policy engine.
- Add action risk levels, idempotency, compensation metadata, and verification results.
- Default unknown or irreversible actions to explicit approval.

## Phase 4 - Personal state engine

Outcome: agents reason from one temporal, provenance-aware owner state.

- Evolve the current scoped memory, CIN, calendar, and personal collections.
- Attach source, confidence, freshness, sensitivity, and contradiction state.
- Expose projections for domains instead of duplicating canonical facts.

## Phase 5 - Verified learning loop

Outcome: real usage improves retrieval, routing, and prompts without unsafe online
weight updates.

- Capture sanitized success/failure trajectories and explicit owner corrections.
- Promote changes through offline evaluation and canary rollout.
- Consider LoRA only after a curated dataset and rollback benchmark exist.

## Phase 6 - Public production readiness

Outcome: multi-tenant operation with predictable reliability and supportability.

- Finish scoped-storage migration and tenant isolation tests.
- Enforce immutable registry images, resource limits, SLOs, tracing, backups, and drills.
- Run staged load, security, disaster-recovery, and browser product verification.

## Stop conditions

- Do not add agents to compensate for an unmeasured model failure.
- Do not split a service without evidence of an independent operational boundary.
- Do not fine-tune on raw production conversations.
- Do not call a phase complete from typecheck alone; its acceptance evidence must exist.
