import { defineConfig } from 'vitest/config';

/**
 * K1 Consolidation Prep (D-168) — characterization baseline for this
 * service's current, pre-consolidation behavior. In-process inject + fake
 * Db, same pattern as gateway-api's characterization suite.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
