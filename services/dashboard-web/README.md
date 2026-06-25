# Dashboard Web (`dashboard-web`)

Real-time control room (Next.js 16, App Router, React 19).

## Pages
`/overview` `/agents` `/services` `/tasks` `/tasks/:id` `/infrastructure`
`/approvals` `/memory` `/skills` `/docs` `/events` `/logs` `/research` `/settings`

## How it talks to the system
- **Reads/writes** go to the **gateway-api** server-side (`FACTORY_API_URL`) using
  the admin token. Secrets never reach the browser.
- **Live updates** stream via a server Route Handler (`/api/stream`) that proxies
  the **event-bus** SSE feed using the internal token. The browser subscribes to
  the same-origin `/api/stream` with `EventSource`.

## Deployment
Independently deployable on Dokploy. Root directory `services/dashboard-web` ·
Port `4100` · Domain `factory.simorx.com`.
