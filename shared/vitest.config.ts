import { defineConfig } from 'vitest/config';

/**
 * Phase K1.1 — contract/unit tests for @factory/shared.
 * Tests import TypeScript source directly (vitest resolves the codebase's
 * NodeNext-style `.js` specifiers to `.ts` sources); no build required.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Contract tests are pure (no DB, no network) — fail fast if one hangs.
    testTimeout: 10_000,
  },
});
