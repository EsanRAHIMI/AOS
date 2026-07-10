import { defineConfig } from 'vitest/config';

/** K1 Consolidation Prep (D-168) — service-kit's own unit tests. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
