# Browser Testing Agent (`browser-testing-agent`)

## Purpose
Permission-governed UI validation. Given a test plan it opens a URL and asserts
title / HTTP status / text / selector, optionally capturing a screenshot to S3,
and returns a structured `BrowserTestReport` with evidence.

## Modes
- **playwright** — real browser via `playwright-core` (install it + `playwright install chromium`).
- **http_fallback** — when no browser is available: fetches the URL and checks
  status, `<title>`, and text presence from the HTML (selector checks best-effort).
- **blocked** — target not on the internal/owned allowlist and not approved.

## Safety
Only internal/owned targets are allowed by default: `localhost`, `*.simorx.com`,
and generated services' health/manifest endpoints. Arbitrary external URLs are
blocked unless explicitly approved.

## Task input (`POST /.factory/task`)
`input`: `{ url, checks: [{type,value}], screenshot? }` where `type` ∈
`title_equals|title_contains|status_is|text_present|selector_present`.

## Standard endpoints
`/health`, `/.factory/manifest|status|capabilities|task|logs` via @factory/service-kit.

## Deployment
Independently deployable on Dokploy. Root `services/browser-testing-agent` ·
Port `4116` · Domain `browser-testing.simorx.com`.
