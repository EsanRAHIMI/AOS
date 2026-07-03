# code-operator-agent

The operator runtime's hands on the codebase (Phase X). Executes workspace-scoped
code tools for the Autonomous Operator Runtime: inspect, search, dry-run patch
preview, isolated-branch edits, typecheck/build/smoke runs, git branch/commit, PR.

## Purpose
Give the operator runtime a REAL coding path — not generic tasks. The gateway's
runtime loop calls this agent for every `code`/`git`/`test` tool after the
required approval has been granted.

## Safety model
- Confined to `CODE_WORKSPACE_ROOT`; path traversal rejected; without it every
  tool reports `not_configured` (never fakes).
- Edits refused on the default branch — an isolated work branch is mandatory.
- Protected-core paths (`services/gateway-api/`, `services/dashboard-web/`,
  `shared/src/`) are flagged in previews and refused on edit unless the gateway
  passes `approvedForProtectedCore` after explicit owner approval.
- `edit_code` refuses blind writes: the exact target text must exist.
- Every run is an agent_run + operator event; mutating results feed evidence
  upstream in the runtime session.

## Task actions (`POST /.factory/task`, input `{ action, ... }`)
`status` · `inspect_repo{path}` · `search_code{pattern,path}` ·
`propose_code_change{file,find,replace}` (dry-run) ·
`edit_code{file,find,replace,branch,approvedForProtectedCore}` ·
`run_typecheck{package}` · `build_package{package}` · `run_smoke_tests{script}` ·
`create_git_branch{branch}` · `commit_changes{message}` · `create_pr{title,branch}`

## Env
See `.env.example` (port 4122, subdomain code.simorx.com). `CODE_WORKSPACE_ROOT`
enables code tools; GITHUB_* enables push/PR.

## Deployment
Independent Dokploy app like every other service. In production, mount/clone a
dedicated working checkout for `CODE_WORKSPACE_ROOT` — never the running app dir.

## Current status
Live: all listed actions implemented. Future: richer diff previews, multi-file
patches, LLM-driven patch synthesis through the existing LLM router.
