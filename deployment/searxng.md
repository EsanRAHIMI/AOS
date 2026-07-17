# SearXNG — self-hosted metasearch for AOS research (K2, D-177)

AOS research is **local-first and self-hostable**. SearXNG is the preferred
metasearch layer; it is optional (direct URL/RSS/sitemap research works
without it) but recommended for broad web coverage. **No paid search API is a
runtime requirement** — do not substitute Tavily/SerpAPI/Bing/Google CSE for
this.

When `SEARXNG_BASE_URL` is unset, `GET /v1/jarvis/intelligence-status` and the
`research_coverage_status` tool honestly report `coverage: direct_only` and the
UI shows reduced coverage — never a silent paid fallback.

## Dokploy deployment

Create a new Dokploy application:

- **App name:** `searxng`
- **Source:** Docker image `searxng/searxng:latest`
- **Port:** `8080` (container)
- **Domain:** `search.simorx.com` (internal use is fine; keep it private)
- **Volume:** mount `/etc/searxng` for `settings.yml`
- **Environment:**
  - `SEARXNG_BASE_URL=https://search.simorx.com/`
  - `SEARXNG_SECRET=<generate: openssl rand -hex 32>`

`settings.yml` must enable the JSON format (AOS calls `/search?format=json`):

```yaml
search:
  formats:
    - html
    - json
server:
  secret_key: "<same as SEARXNG_SECRET>"
  limiter: false            # or configure a rate limiter for public exposure
```

## Local docker-compose (dev)

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    ports: ["8080:8080"]
    environment:
      SEARXNG_BASE_URL: "http://localhost:8080/"
    volumes:
      - ./searxng:/etc/searxng
```

## Wire into AOS

Set on gateway-api (and any process running research tools):

```
SEARXNG_BASE_URL=http://localhost:8080     # or https://search.simorx.com
```

Restart the service. Verify:

```
curl -s "$SEARXNG_BASE_URL/search?q=test&format=json" | head
```

`webSearchProviderFromEnv` then returns the `searxng` provider and the
`research_web_search` tool flips to `available: true`.

## Robots, rate limits, terms

AOS direct fetching (`research_fetch_url`) honors `robots.txt` disallow rules,
sends a descriptive User-Agent, and never bypasses authentication, paywalls or
CAPTCHAs. Configure SearXNG's own engine rate limits responsibly.
