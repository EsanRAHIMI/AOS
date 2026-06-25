# File Asset Service (`file-asset-service`)

## Purpose
File and media storage on AWS S3 with MongoDB-tracked metadata and signed URLs for all other services.

## Public endpoints
- `GET /health` — liveness (unauthenticated)

## Internal endpoints (require `x-factory-internal-token`)
- `GET /.factory/manifest`, `GET /.factory/status`, `GET /.factory/capabilities`, `POST /.factory/task`, `GET /.factory/logs`
- Service-specific routes documented below.

## Environment variables
See `.env.example` and `docs/environment-variables.md`.

## Deployment
Independently deployable on Dokploy. Root directory: `services/file-asset-service` · Port `4112` · Domain `assets.simorx.com`.

## Current status
Phase 1 — functional core.
