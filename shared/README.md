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
- `schemas/` — Zod schemas (manifest, task, agent-run, infra-request, event, approval, memory, s3-object, and one file per later phase — capability, reality, operations, reasoning, governance, learning, workflows, security, voice, workspace, scope, personal, jarvis, …)
- `contracts/` — cross-service API contract types
- `env/` — validated env loaders (base + mongo/s3/llm fragments)
- `db/` — MongoDB Atlas connection layer + typed collection accessors
- `storage/` — AWS S3 `FileStorage` abstraction
- `logging/`, `http/`, `auth/`, `utils/`, `manifest/`, `events/`, `registry/`
- `scope/` — the `canAccess` tenant/user/project/case scope engine (Phase AA)
- `personal/` — personal reality graph, next-best-action, daily briefing, weekly strategy, opportunity ranking, resume analysis engines (Phase AB); universe zone builder (Phase AC+)
- `jarvis/` — Jarvis intelligence core, memory-fact extraction, quality scoring, daily-brain briefing (Phase AD/AE/AE.1)
- `operator/` — operator tool registry + plan→tool→observe→approve loop (Phase X)
- `workspace/` — isolated staging workspace / service-evolution runtime (Phase Y)
- `voice/` — realtime voice tool-mediation router (Phase 18)
- `llm/` — LLM provider router with schema-validated deterministic fallback
- `dokploy/`, `github/` — Dokploy API client and GitHub delivery client
- `governance/`, `policy/`, `scoring/`, `security/`, `learning/`, `repair/`, `planner/`, `evaluation/`, `activation/`, `capability/`, `evidence/`, `discovery/`, `deployment/`, `agentrun/`, `workflows/`, `validation/`, `intelligence/`, `types/` — one module per governance/reasoning/learning/repair/reality-execution phase (Phases 3–13); see `docs/phase-log.md` for what each phase built

## Build
```bash
pnpm --filter @factory/shared run build
```