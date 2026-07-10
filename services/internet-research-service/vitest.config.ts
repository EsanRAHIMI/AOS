import { defineConfig } from 'vitest/config';

/**
 * K1 Consolidation Prep Batch 2A (D-172) — characterization baseline for
 * this service's current, pre-consolidation behavior. In-process inject +
 * fake Db, same pattern as architect-agent's characterization suite (D-168).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
