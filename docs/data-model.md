# Data Model (MongoDB Atlas)

Primary datastore for all text/structured data, logs, task records, memory,
documents, agent traces, and system state. Collection names are defined once in
`shared/src/constants/index.ts` (`COLLECTIONS`) — never hardcode strings.

## Collections
| Collection | Purpose | Schema (shared/src/schemas) |
|---|---|---|
| users | Operators / admins | — |
| sessions | Auth/session records | — |
| services | Registry records (manifest + lifecycle) | service-manifest.ts |
| agents | Agent definitions | — |
| tasks | Goals tracked end-to-end | task.ts (TaskSchema) |
| task_runs | Per-attempt task execution | task.ts |
| agent_runs | One execution of an agent on a task | agent-run.ts (AgentRunSchema) |
| agent_messages | Prompts/responses/tool-calls (for memory + training) | agent-run.ts |
| events | All system events (event bus persistence) | event.ts (SystemEventSchema) |
| logs | Structured logs | — |
| approvals | Sensitive-action decisions | approval.ts (ApprovalSchema) |
| infrastructure_requests | Dokploy infra the human must create | infrastructure-request.ts |
| memories | Compact reusable memory records | memory.ts (MemorySchema) |
| skills | Promoted reusable patterns | memory.ts (SkillSchema) |
| documents | Documentation store (versioned by slug) | — |
| decision_logs | Architecture/decision records | — |
| phase_logs | Phase completion records | — |
| research_reports | Cited research summaries | — |
| files / s3_objects | S3 object metadata | s3-object.ts (S3ObjectSchema) |
| deployments | Deployment records | — |
| environment_specs | Required env per service | — |
| service_manifests | Manifest history | service-manifest.ts |
| api_contracts | Stored API contracts | — |
| cost_records | Token/cost tracking | — |
| system_settings | Admin-configurable settings | — |
| evolution_proposals | Self-improvement proposals | — |

## Conventions
- IDs are prefixed (`task_…`, `arun_…`, `evt_…`) via `genId(prefix)`.
- Timestamps are ISO-8601 strings (`createdAt`, `updatedAt`).
- Indexes: unique on natural id (`serviceId`, `taskId`, `objectId`, …);
  time/compound indexes on `events` for fast streaming/history.

## Phase 3 — Self-Expanding Capability Engine collections
| Collection | Purpose | Schema (shared/src/schemas/capability.ts) |
|---|---|---|
| capabilities | The capability graph: what the kernel can do | CapabilitySchema |
| capability_gaps | Required capabilities the kernel lacks | CapabilityGapSchema |
| expansion_proposals | Plans to add a missing capability (new service/agent/tool) | ExpansionProposalSchema |
| capability_evaluations | Multi-dimensional evaluation records | EvaluationSchema |
| llm_traces | LLM reasoning calls: prompt, completion, validity, cost | LlmTraceSchema |
| skills (extended) | Reusable operational patterns | SkillSchema (memory.ts) |

### Capability (capabilities)
`capabilityId, title, description, category, supportedByServices[], supportedByAgents[],
supportedByTools[], requiredEnv[], requiredPermissions[], relatedDocs[], relatedMemories[],
status (active|proposed|generated|deprecated|failed), maturityLevel (concept|early|stable|mature),
riskLevel, evaluationScore (0..1), lastUsedAt, createdAt, updatedAt`.

### CapabilityGap (capability_gaps)
`gapId, taskId, requiredCapability, reason, recommendedExpansion, severity (missing|weak),
riskLevel, status (open|proposed|resolved|dismissed), createdAt`.

### ExpansionProposal (expansion_proposals)
`proposalId, sourceTaskId, gapId, missingCapability, proposedServiceName, proposedAgentName,
proposedToolName, reason, architecturePlan, requiredEnv[], requiredPermissions[], riskLevel,
expectedImpact, evaluationPlan, status (waiting_approval|approved|rejected|changes_requested|
building|generated|failed), generatedServicePath, infrastructureRequestId, createdAt, updatedAt`.

### Evaluation (capability_evaluations)
`evaluationId, targetType (capability|service|agent|task|expansion), targetId, taskId, score (0..1),
dimensions { correctness, reliability, speed, cost, humanInterventionRequired, reusability,
documentationQuality, memoryQuality, risk, productionReadiness }, strengths[], weaknesses[],
recommendations[], createdAt`.

### LlmTrace (llm_traces)
`traceId, agentId, taskId, taskType, provider (anthropic|openai|mock), model, system, prompt,
completion, valid, usedFallback, attempts, tokensIn, tokensOut, costUsd, createdAt`.

### Skill (skills, extended in Phase 3)
Adds `category, triggerConditions[], requiredCapabilities[], requiredServices[], examples[],
successRate, relatedMemories[], relatedDocs[], lastUsedAt` to the Phase 1 fields.

## Phase 4 — Reality Execution Layer collections
| Collection | Purpose | Schema (shared/src/schemas/reality.ts) |
|---|---|---|
| runtime_validations | Factory-standard validation results for generated services | RuntimeValidationSchema |
| github_operations | Branch/commit/PR delivery records (real or prepared) | GitHubOperationSchema |
| evidence_records | Proof for every claim (logs, checks, screenshots, reports) | EvidenceRecordSchema |

### RuntimeValidation (runtime_validations)
`validationId, taskId, serviceName, capabilityId, validationType (static|build|runtime|full),
checks[{name,passed,detail}], passed, score (0..1), logs[], recommendations[], createdAt`.

### GitHubOperation (github_operations)
`operationId, taskId, proposalId, capabilityId, serviceName, branchName, baseBranch,
commitSha, pullRequestUrl, mode (github_api|prepared), status (prepared|committed|pushed|
pr_open|failed), filesChanged[], summary, instructions, createdAt, updatedAt`.

### EvidenceRecord (evidence_records)
`evidenceId, taskId, capabilityId, serviceName, type (build_log|typecheck_log|
health_check_result|manifest_check_result|screenshot|test_report|service_response|
deployment_check|github_commit|approval_decision|validation_report), summary, data,
s3ObjectId, createdAt`.

### Capability lifecycle (Phase 4)
`CapabilityStatus` extended to: `proposed → approved → generated → validated → active`
(+ `deprecated`, `failed`). Promotion rules: `generated → validated` only after runtime
validation passes; `validated → active` only after the service registry confirms a
reachable manifest. Browser test contracts (`BrowserTestPlanSchema`, `BrowserTestReportSchema`)
also live in reality.ts.
