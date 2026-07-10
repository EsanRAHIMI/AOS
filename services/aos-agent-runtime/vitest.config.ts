import { defineConfig } from 'vitest/config';

/**
 * K1 Consolidation Prep (D-168) — characterization equivalence suite: these
 * assertions must match architect-agent/qa-agent/reviewer-agent/report-
 * agent's own baseline suites exactly. fileParallelism disabled because one
 * describe block in this file binds the real historical ports
 * (4103/4106/4107/4114) to prove correct port assignment — must not
 * interleave with anything else that could touch those ports.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
