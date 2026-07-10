import { defineConfig } from 'vitest/config';

/** K1 Real Auth dashboard bridge (D-165) — first test suite in dashboard-web.
 * Scoped narrowly to pure, network-mocked unit tests for the auth bridge
 * (lib/gateway-session.ts). Deliberately does NOT attempt to test React
 * components/pages (no jsdom/testing-library setup) — out of scope for
 * "minimal compatibility," not a gap in this pass. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
