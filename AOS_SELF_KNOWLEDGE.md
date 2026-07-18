# AOS Self-Knowledge (human-readable mirror)

The **live, machine-read** self-knowledge is the `AOS_SELF_KNOWLEDGE` constant
in `shared/src/jarvis/index.ts` — Jarvis answers meta questions ("why isn't
this real yet", "what's next") from it. This file mirrors it for humans and
must be kept in sync with that constant and with `docs/current-state.md`.

_As of commit `58a189e` (2026-07-18)._

## What AOS honestly is now

A governed, self-developing personal-intelligence OS with a **real shared
multi-turn agent runtime** (not the old single-shot form-filler). Jarvis is a
persistent, bilingual (FA/EN) command surface with durable sessions, Memory v2
(cross-session recall, provenance, confirmed/inferred/temporary), a mission
hierarchy, personal operating state, independent (self-hostable) research, a
governed tool registry with in-conversation approval + exact resume, and a
real self-development pipeline. All of this is RUNTIME_VERIFIED against real
Redis + real MongoDB.

## What is real vs still blocked

**PRODUCT_VERIFIED = 0.** No flow has run through the real browser with a real
model. RUNTIME_VERIFIED below = real Redis+Mongo over HTTP/Node, NOT browser.

- **RUNTIME_VERIFIED (real Redis+Mongo, HTTP/Node — not browser):** agent loop,
  sessions/turns + reload continuity, Memory v2 + cross-session recall, personal
  state + onboarding, missions, owner briefing, approval pause/exact-resume,
  tool registry, one real self-development code change (branch `selfdev/
  mission-next-action`, +165/−5, tests+build green, not merged).
- **RUNTIME_VERIFIED_EXTERNAL_INPUT:** the research pipeline processed REAL
  sources, but the SOURCES were fetched by the agent's external web tools, not
  by AOS's own research tools — so this does NOT prove AOS researches
  independently.
- **CODE_COMPLETE:** model provider wire (mock-server tested), `/jarvis` UI.
- **BLOCKED_EXTERNAL (build sandbox):** real model **reasoning quality** (no
  reachable model/weights/endpoint; only `api.anthropic.com` host, no key),
  real-**browser** `/jarvis` (chromium `libXdamage.so.1` missing, no root),
  **AOS-native web research** (module's own fetch is allowlist-blocked). Enable
  a model with `LLM_LOCAL_BASE_URL` (Ollama) or `ANTHROPIC_API_KEY`; run the
  browser suite with `playwright install --with-deps chromium`; deploy SearXNG
  for AOS-native search.

## Honest gaps

- Autonomous model-driven tool orchestration in `/jarvis` has not been run
  end-to-end (needs a real model).
- Live multi-source web research synthesis needs network egress + a model.
- The self-development *decision* step is model-driven; the *engineering*
  pipeline (branch/diff/verify/review/reflect, approval-gated) is real and run.
- No PRODUCT_VERIFIED status is claimed for any flow yet (no authenticated
  real-browser run happened in this environment).

## Highest-leverage next step

Point `LLM_LOCAL_BASE_URL` at a local Ollama with a tool-capable model and run
the browser suite; then the core owner scenarios can move from
RUNTIME_VERIFIED to PRODUCT_VERIFIED. See `docs/current-state.md` §8 for exact
commands.
