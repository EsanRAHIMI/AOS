import { defineConfig } from 'vitest/config';

/**
 * K1 BullMQ Producer Adoption (D-174) — first test suite for
 * orchestrator-agent. Scoped narrowly to dispatchPeerTask (pipeline.ts's
 * mode-aware dispatch wrapper) against a fake Mongo — no real Mongo, no
 * real Redis, no LLM calls. Full pipeline behavior (runPipeline,
 * runDelegationPipeline, etc.) has no prior test coverage in this service
 * and is out of scope here; see decision-log D-174 for why this is a
 * deliberately narrow addition, not a full characterization suite.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
