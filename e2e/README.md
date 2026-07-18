# Real-browser `/jarvis` verification (K2, D-178)

Drives the ACTUAL dashboard in real Chromium via Playwright — the only thing
that counts as PRODUCT_VERIFIED for the owner UI.

## Status in the AOS build sandbox (honest)

- **Browser LAUNCH: unblocked (D-178d).** Real Chromium 149 launches headless
  here using the `libXdamage.so.1` stub (`sandbox-libs/build-xdamage-stub.sh`) —
  proven by launching + rendering + screenshotting.
- **Full dashboard browser E2E: BLOCKED by this sandbox's limits**, not by the
  browser. The build sandbox kills every process between shell calls and caps
  each call at ~45s, so it cannot complete a Next.js production build (~minutes)
  or hold the dashboard + gateway + Mongo + Redis + browser alive together. On a
  normal machine / CI this is a non-issue.
- **Real model reasoning: BLOCKED_EXTERNAL** — needs `LLM_LOCAL_BASE_URL`
  (Ollama) or `ANTHROPIC_API_KEY`. Without it, the browser run can only verify
  the degraded-mode UI (sessions, personal state, memory, reload); streaming
  reasoning / tool steps / approval elicitation need a real model.

## Run it (normal machine — recommended)

```bash
npx playwright install --with-deps chromium
# gateway with a real local model:
export LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 LLM_LOCAL_MODEL=qwen2.5:7b
pnpm --filter @factory/gateway-api dev &            # :4101 (MONGODB_URI, REDIS_URL set)
pnpm --filter @factory/dashboard-web build
pnpm --filter @factory/dashboard-web start &        # :4100 (FACTORY_API_URL=http://127.0.0.1:4101)
BASE_URL=http://127.0.0.1:4100 npx playwright test -c e2e/playwright.config.ts
```

Traces + screenshots land in `e2e/report/`.

## Run it (constrained Linux, no root — the sandbox path)

```bash
export PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers
npx playwright install chromium                     # downloads browser (no deps)
bash e2e/sandbox-libs/build-xdamage-stub.sh /tmp/aos-stublibs
export LD_LIBRARY_PATH=/tmp/aos-stublibs:$LD_LIBRARY_PATH
export PW_CHROMIUM_PATH=$(ls /tmp/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
# then run the dashboard (prebuilt) + gateway + the test as above
BASE_URL=http://127.0.0.1:4100 npx playwright test -c e2e/playwright.config.ts
```

`jarvis.spec.ts` covers: login → open `/jarvis` → create session → Persian text
→ streaming → tool steps → reload continuity → memory tab → approval card →
approve+resume → reject (no mutation) → cancel. The approval/streaming/tool
assertions `test.skip` themselves when no real model is configured.
