import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** K1 Real Auth dashboard bridge (D-165) — first test suite in dashboard-web.
 * Scoped narrowly to pure, network-mocked unit tests for the auth bridge
 * (lib/gateway-session.ts). Deliberately does NOT attempt to test React
 * components/pages (no jsdom/testing-library setup) — out of scope for
 * "minimal compatibility," not a gap in this pass. */
export default defineConfig({
  // Mirror the Next.js `@/*` path alias so tests import components exactly the
  // way the app does — otherwise a test would exercise a different module
  // graph than production.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Build-time marker package; see test/stubs/server-only.ts.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // D-187 added .tsx: the profile components are rendered for real with
    // react-dom/server (static render, no jsdom needed — they are server
    // components), which is what catches shape problems typecheck cannot.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
