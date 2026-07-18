/**
 * Playwright config for the real-browser `/jarvis` verification (K2, D-178).
 *
 * On a normal machine:
 *   npx playwright install --with-deps chromium
 *   pnpm --filter @factory/gateway-api dev &      # :4101 (with LLM_LOCAL_BASE_URL set)
 *   pnpm --filter @factory/dashboard-web build && pnpm --filter @factory/dashboard-web start &  # :4100
 *   BASE_URL=http://127.0.0.1:4100 npx playwright test -c e2e/playwright.config.ts
 *
 * In a constrained Linux sandbox WITHOUT root (chromium missing only
 * libXdamage.so.1): build the stub once and export the two env vars — see
 * e2e/sandbox-libs/build-xdamage-stub.sh. This was proven to launch real
 * Chromium 149 headless in the AOS build sandbox (D-178d).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:4100',
    screenshot: 'on',
    trace: 'on',
    video: 'retain-on-failure',
    // Sandbox stub path (harmless on a normal machine where the flags are unset).
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
  },
});
