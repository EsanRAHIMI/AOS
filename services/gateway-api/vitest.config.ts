import { defineConfig } from 'vitest/config';

/** K1.3 — gateway characterization tests (in-process inject + fake Db). */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    // Characterization suites build full gateway instances; keep them serial
    // so the shared setTestDb seam never sees two builds interleaved.
    fileParallelism: false,
  },
});
