# Testing & CI

Phase K1 introduced the trust substrate defined in `master-direction.md` (§D Phase K1, §J).
Rule zero: **no feature or refactor merges without tests that pin its contract.**

## Test taxonomy

| Kind | Location | What it pins | Runs |
|---|---|---|---|
| Contract tests | `<package>/test/*.contract.test.ts` | Public behavior other code relies on: auth guards, scope/isolation engine, LLM validation invariant, envelopes, event schema, Jarvis grounding | Every CI run, <1s |
| Unit tests | `<package>/test/*.test.ts` | Internal logic of one module | Every CI run |
| Scenario tests | (K2+) staging scripts | End-to-end flows with real services/models | Pre-release |
| Isolation probes | (K1.4+) | Automated cross-tenant read/write attempts that MUST fail | Every CI run + scheduled in prod |

Naming: `*.contract.test.ts` means "breaking this test = breaking a consumer or a security
guarantee"; changing one requires a decision-log entry, not just a code change.

## Running

```bash
pnpm test                 # recursive: every package with a test script
pnpm --filter @factory/shared test         # one package
pnpm --filter @factory/shared test:watch   # watch mode
```

Tests import TypeScript source directly (vitest resolves the NodeNext `.js` specifiers);
no build step is required before testing.

## Current coverage (K1.1)

`shared/test/` — 93 tests across 6 suites:
- `auth.contract.test.ts` — internal/admin token guards, timing-safe compare, header contracts.
- `scope-engine.contract.test.ts` — `canAccess`: fail-closed rules, user/tenant/global/case
  isolation, consent gate, agent-approval prohibition, owner approval-gating, goal classifier.
- `scope-stamp-filter.contract.test.ts` — `stampScope`/`scopeFilter` fail-closed write/read halves.
- `llm-router.contract.test.ts` — nothing unvalidated escapes `generateStructured`; honest
  fallback tracing; governance defaults; cost-record mapping. No network touched.
- `jarvis-grounding.contract.test.ts` — bilingual intent fallback, packet ranking/capping,
  user_priority precedence, the priority-ignored correction gate.
- `schemas-envelopes.contract.test.ts` — API envelopes, event contract (incl. the D-155
  required-`source` regression), id/time utilities.

## What replaced the smoke scripts

The bespoke `scripts/phase*-smoke.mjs` files predate the test runner. Policy: when a change
touches an area a smoke script covers, convert that coverage into vitest tests and delete the
script in the same PR. Do not add new smoke scripts.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml` (added in K1.2). Gates on every push/PR
to `main`: install (frozen lockfile) → build shared + service-kit → recursive typecheck →
recursive tests. A red CI blocks merge; no exceptions, including for agents.

## Known constraints

- The local dev mount blocks `pnpm install` writes (see README-SETUP); installs and full test
  runs during agent sessions happen in a sandbox-local copy — CI is the canonical verifier.
- Service-level tests (gateway routes, event bus) land with the K1 gateway split, where routes
  become importable modules; testing a 3,698-line `index.ts` entrypoint is not practical, which
  is itself part of the case for the split (master-direction §F).
