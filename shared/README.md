# @factory/shared

Build-time shared contracts for every Autonomous OS Kernel service.

## Purpose
Single source of truth for **contracts, Zod schemas, inferred types, constants,
and reusable utilities** (env validation, structured logging, MongoDB Atlas
connection, AWS S3 abstraction, internal-token auth, API response envelope,
service-manifest helpers, event publisher, registry client).

## Critical rule
This package is a **build-time dependency only**. Deployed containers do **not**
call each other through shared code at runtime — they communicate over HTTP
using the contracts defined here, authenticated with internal tokens and
discovered via configured service URLs / the service-registry.

## Layout
- `constants/` — service ids, ports, subdomains, collections, event types, S3 keys
- `schemas/` — Zod schemas (manifest, task, agent-run, infra-request, event, approval, memory, s3-object)
- `contracts/` — cross-service API contract types
- `env/` — validated env loaders (base + mongo/s3/llm fragments)
- `db/` — MongoDB Atlas connection layer + typed collection accessors
- `storage/` — AWS S3 `FileStorage` abstraction
- `logging/`, `http/`, `auth/`, `utils/`, `manifest/`, `events/`, `registry/`

## Build
```bash
pnpm --filter @factory/shared run build
```