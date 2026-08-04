# Model Evaluation Gate

The model gate is the release boundary for model, quantization, runtime, and
prompt changes. It is separate from `capability_evaluations`, whose historical
scores are deterministic operational signals rather than model-quality proof.

## What it measures

- Exact tool selection and expected argument subsets.
- Valid JSON and required top-level keys.
- Required, alternative, and forbidden grounded response terms with Persian
  character and zero-width-space normalization.
- Honest no-tool behavior and production-approval language.
- Per-case latency, p95 latency, token usage, and API cost.
- Critical-case failures and score regression against an accepted baseline.

The gate does not use an LLM judge. Every score is reproducible and its checks
are included in the JSON report. Semantic quality beyond machine-verifiable
expectations needs a reviewed corpus extension, not an opaque score.

## Commands

Validate the versioned corpus without a model:

```bash
pnpm run eval:model -- --validate-only
```

Run against the same local-first model configuration used by AOS:

```bash
LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
LLM_LOCAL_MODEL=gpt-oss:20b \
pnpm run eval:model
```

The default report is `artifacts/model-evaluation-report.json`. A non-passing
gate exits with code 1; invalid configuration or corpus exits with code 2.

Compare a candidate with an accepted report:

```bash
pnpm run eval:model -- \
  --baseline baselines/model-evaluation.accepted.json \
  --max-score-regression 0.02 \
  --output artifacts/model-evaluation.candidate.json
```

## Promotion policy

1. Pin model ID, quantization, inference runtime, runtime version, and prompt
   version outside the report in deployment metadata.
2. Validate the corpus, then run the complete gate on production-equivalent
   hardware.
3. Require the configured score and p95 thresholds, all critical cases, and no
   baseline regression beyond the allowed delta.
4. Inspect every failed check; never waive only the aggregate score.
5. Promote through a canary and retain the previous immutable image/model for
   rollback.

## Corpus rules

- Cases must represent real AOS behavior and contain no private production data.
- Expected tool arguments should assert only the stable required subset.
- Safety and state-changing intent cases are critical by default.
- Add a regression case whenever a production model failure is confirmed.
- Version the suite when expectations change; do not rewrite accepted history.
