# Dashboard Web (`dashboard-web`)

Real-time control room (Next.js 16, App Router, React 19) — and, since Phase
AD–AF.4.4, the **Living Command Universe home**: a persistent, realtime
personal-and-system command surface, not just an admin panel.

## Home surface (`/`)
The homepage is the Jarvis Command Universe: a persistent Presence Bar +
Focus Row (wired to `GET /v1/jarvis/briefing`), nine Command Universe domain
zones each with a real domain-specific visual renderer (`BodyMap`,
`FinanceFlow`, `HouseholdMap`, `VentureBoard`, `SkillLanes`,
`OpportunityRadar`, `SystemPulse`, `PresenceBadges`, `PriorityStack` — see
`src/lib/domainCanvas.ts`), a domain action layer (accept/reject/ingest
controls per zone card), an Active Operations panel and a grouped, one-
card-per-operation Live Activity feed (both backed by the persistent
`GET /v1/operator/live-state` snapshot so they survive refresh/navigation),
and a docked, persistent Operator Console (Jarvis) summonable from any page.
See `docs/living-command-universe-vision.md` for the product diagnosis that
motivated this, and `docs/phase-log.md` (Phase AF.1–AF.4.4) for what was
actually built.

## Personal layer (`/me/*`)
`/me` (Personal Command Center) plus `/me/{reality,goals,projects,systems,
opportunities,briefing,strategy,resume}` — the Phase AB personal-reality
baseline UI (accept/decline/done controls, missing-data prompts).

## Operator / voice
`/operator` and `/jarvis` (operator runtime pages), `/voice`, `/voice/settings`,
`/voice/sessions` — plus the floating Operator Console dock present on every
page (text or voice command entry, inline approvals, live narration).

## Engine room (AI-factory-internal pages)
The pre-AC+ dashboard is preserved as `/operations` (Mission Control) plus
~55 other route directories for the self-development kernel: `/tasks`,
`/tasks/:id`, `/agents`, `/services`, `/approvals`, `/capabilities`, `/gaps`,
`/expansion-proposals`, `/governance`, `/policy-*`, `/scoring-*`, `/learning*`,
`/incidents`, `/repair-*`, `/reasoning`, `/patterns`, `/security`, `/docs`,
`/events`, `/logs`, `/research`, `/reports`, `/settings`, and more. Full list:
`ls src/app/`.

## How it talks to the system
- **Reads/writes** go to the **gateway-api** server-side (`FACTORY_API_URL`) using
  the admin token. Secrets never reach the browser.
- **Live updates** stream via a server Route Handler (`/api/stream`) that proxies
  the **event-bus** SSE feed using the internal token. The browser subscribes to
  the same-origin `/api/stream` with `EventSource`. Home-surface components
  additionally use a block-invalidation model (`UniverseProvider` +
  `lib/realtimeBlocks.ts`) that re-fetches only the affected data blocks when
  a relevant event arrives.

## Deployment
Independently deployable on Dokploy. Root directory `services/dashboard-web` ·
Port `4100` · Domain `factory.simorx.com`.

## Current status
Through Phase AF.4.4 (2026-07-09) — see `docs/phase-log.md`. `tsc --noEmit`
verified clean; `next build` cannot be verified in this sandbox (missing
`@next/swc-linux-arm64` binary, no WASM fallback installed — see D-124 in
`docs/decision-log.md`).
