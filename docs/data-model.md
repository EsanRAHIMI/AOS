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

## Phase 5 — Live Activation & Runtime Autonomy collections
| Collection | Purpose | Schema (shared/src/schemas/operations.ts) |
|---|---|---|
| service_activations | Live activation checks proving a service is deployed & usable | ServiceActivationSchema |
| deployment_checklists | Precise Dokploy activation checklists (copyable env) | DeploymentChecklistSchema |
| monitor_runs | Periodic health scans across registered services | MonitorRunSchema |
| incidents | Detected failures (activation/monitor) | IncidentSchema |
| repair_tasks | Proposed fixes for incidents (the repair loop) | RepairTaskSchema |

### ServiceActivation (service_activations)
`activationId, taskId, serviceName, capabilityId, domain, checks[{name,passed,detail}],
passed, status (running|passed|failed), evidenceIds[], promotedToActive, incidentId,
createdAt, updatedAt`. Critical checks: domain_reachable, health_ok, manifest_valid,
task_endpoint_accepts.

### DeploymentChecklist (deployment_checklists)
`checklistId, taskId, serviceName, capabilityId, appName, repository, rootDirectory,
buildCommand, startCommand, port, subdomain, healthCheckPath, env[{key,value,secret}],
notes[], verificationSteps[], status (awaiting_deployment|deployed|activated|failed),
createdAt, updatedAt`.

### MonitorRun / Incident / RepairTask
MonitorRun: `monitorRunId, scope, services[ServiceHealth], healthyCount, unhealthyCount,
incidentIds[], createdAt`. Incident: `incidentId, serviceName, capabilityId, taskId, title,
detail, severity, status, source (activation|monitor), evidenceIds[], repairTaskId, …`.
RepairTask: `repairTaskId, incidentId, serviceName, diagnosis, proposedFix,
recommendedAction (redeploy|fix_env|rebuild|rescaffold|manual), requiresApproval, status, …`.

### Lifecycle rule (enforced)
`validated → active` happens **only** when the live activation check passes against a real,
reachable service. The kernel never fakes `active`.

## Phase 6 — Autonomous Repair & Execution collections
| Collection | Purpose | Schema (shared/src/schemas/operations.ts) |
|---|---|---|
| repair_diagnoses | Ranked suspected causes for a failure | RepairDiagnosisSchema |
| repair_plans | Structured, executable, approval-gated repair plans | RepairPlanSchema |

### RepairDiagnosis (repair_diagnoses)
`diagnosisId, incidentId, repairTaskId, serviceName, capabilityId,
suspectedCauses[{cause,confidence,evidence[]}], confidence, evidenceIds[],
recommendedFixes[], requiresHumanAction, riskLevel, createdAt`.

### RepairPlan (repair_plans)
`repairPlanId, diagnosisId, repairTaskId, incidentId, serviceName, capabilityId,
planType (env_fix|redeploy|domain_fix|code_patch|dependency_fix|registry_fix|
manual_action|unknown), steps[], requiredApprovals[], requiredEnvChanges[],
requiredCodeChanges[], requiredDokployActions[], validationAfterRepair,
requiresHumanAction, status (draft|waiting_approval|approved|rejected|
changes_requested|executed|failed), createdAt, updatedAt`.

### Extended lifecycles (Phase 6)
Incident: `open → diagnosing → repair_planned → waiting_approval → repairing →
waiting_manual_action → validating → resolved | failed`.
RepairTask: `proposed → diagnosing → planned → waiting_approval → approved →
executing → waiting_manual_action → validating → completed | failed | cancelled`.
EvidenceType adds: diagnosis_report, repair_plan, repair_attempt,
env_fix_instruction, code_patch, validation_after_repair, activation_after_repair,
incident_closed. Incidents never close without an `incident_closed` evidence record,
and a capability returns to `active` only after the post-repair activation check passes.

## Phase 7 — Strategic Reasoning & Policy-Governed Execution collections
| Collection | Purpose | Schema (shared/src/schemas/reasoning.ts) |
|---|---|---|
| strategic_plans | Candidate plans (safe/fast/ambitious) per goal | StrategicPlanSchema |
| plan_scores | 10-dimension scores per candidate + selection | PlanScoreSchema |
| policy_decisions | allowed/blocked/approval_required per sensitive action | PolicyDecisionSchema |
| decision_memories | Options, choice, justification, outcome, lessons | DecisionMemorySchema |

### StrategicPlan (strategic_plans)
`planId, taskId, goal, label (safe_plan|fast_plan|ambitious_plan), title, steps[],
requiredCapabilities[], servicesInvolved[], toolsInvolved[], requiredApprovals[],
expectedCostUsd, expectedTimeMinutes, riskLevel, reversibility (0..1), confidence (0..1),
expectedImpact, failureModes[], validationPlan, selected, createdAt`.

### PlanScore (plan_scores)
`scoreId, planId, taskId, label, dimensions { successProbability, risk, cost, speed,
evidenceAvailability, reversibility, humanIntervention, capabilityFit, policyCompliance,
longTermValue }, total, selected, selectionReason, createdAt`.

### PolicyDecision (policy_decisions)
`policyDecisionId, taskId, planId, action (code_change|github_action|deployment_action|
environment_change|external_api_call|send_message|browser_action|file_delete|data_mutation|
production_change|physical_action|run_validation|read_only), decision (allowed|blocked|
approval_required), reason, requiredApprovalType, riskLevel, createdAt`.

### DecisionMemory (decision_memories)
`decisionId, taskId, goal, selectedPlanId, selectedReason, alternatives[{planId,label,reason}],
outcome, evidenceIds[], evaluationId, lessons[], createdAt`.

### Reasoning rules (enforced)
LLM output is schema-validated (`CandidatePlansSchema`); the deterministic fallback is itself
validated, so no unvalidated output mutates state. `LlmTrace` gains `promptVersion`. Every
sensitive action passes the policy engine; `file_delete` and `physical_action` are blocked by
default; code/github/deploy/env/external/message/data/production require approval. The selected
plan is justified and its rejected alternatives recorded.

## Phase 8 — Learning Governance & Adaptive Intelligence collections
| Collection | Purpose | Schema (shared/src/schemas/governance.ts) |
|---|---|---|
| outcome_reviews | Predicted plan score vs actual outcome + recommended changes | OutcomeReviewSchema |
| scoring_profiles | Versioned scoring weights (one active) | ScoringProfileSchema |
| scoring_change_proposals | Proposed weight changes (approve to version a profile) | ScoringChangeProposalSchema |
| policy_rules | Configurable policy overlays (scoped) | PolicyRuleSchema |
| policy_change_proposals | Proposed policy rules | PolicyChangeProposalSchema |
| policy_profiles | Versioned bundles of active policy rules | PolicyProfileSchema |
| roles / permissions / users | RBAC | RoleSchema / PermissionSchema / RbacUserSchema |
| audit_logs | Every governance action (who/what/before/after/why) | AuditLogSchema |

### OutcomeReview
`reviewId, taskId, decisionId, selectedPlanId, selectedPlanScore, actualOutcome,
actualEvaluationScore, predictedVsActual (overestimated|underestimated|accurate), whatWorked[],
whatFailed[], lessons[], recommendedWeightChanges[{dimension,change,reason}], recommendedPolicyChanges[],
recommendedSkillUpdates[], createdAt`.

### ScoringProfile / ScoringChangeProposal
Profile: `profileId, version, weights(10 dims), status (active|archived|proposed), reason,
approvedBy, createdAt, activatedAt`. Only one active; every PlanScore records `profileVersion`.
Proposal: `proposalId, basedOnReviews[], currentWeights, proposedWeights, changes[], reason,
expectedImpact, riskLevel, status, approvedBy, resultingProfileVersion, createdAt, decidedAt`.

### PolicyRule (configurable) + hardcoded overrides
`ruleId, action, decision, reason, requiredApprovalType, riskLevel, scope{serviceName?,capabilityId?,
environment?}, status`. `resolvePolicy(action, ctx, rules)` resolves: (1) **hardcoded safety blocks**
(`file_delete`, `physical_action`) always win, (2) most-specific active matching rule, (3) code default.

### RBAC + AuditLog
Roles: owner (all), operator (run/approve repairs, view), viewer (read-only), agent (request only).
`hasPermission(role, permission)` gates approvals; denials are audit-logged. AuditLog:
`auditId, actorType (human|agent|system), actorId, role, action, targetType, targetId, before, after,
reason, createdAt`. PlanScore gains `profileVersion`.

### Governance rule (enforced)
No adaptive change to scoring or policy is silent: each is proposed → approved (RBAC) → versioned →
audited. Hardcoded safety blocks override any configurable rule. The active scoring profile is used by
the Plan Scoring Engine; rejected proposals preserve the current profile.

## Phase 9 — Operational Learning & Memory Intelligence collections
| Collection | Purpose | Schema (shared/src/schemas/learning.ts) |
|---|---|---|
| learning_runs | One historical-aggregation pass | LearningRunSchema |
| reliability_scores / reliability_snapshots | Reliability over time per target | ReliabilityScoreSchema |
| operational_patterns | Recurring success / failure / weak-point patterns | OperationalPatternSchema |
| memory_summaries / compressed_contexts | Compressed history for cheap future context | MemorySummarySchema / CompressedContextSchema |
| system_recommendations | Evidence-backed improvements (approval applies) | SystemRecommendationSchema |
| prompt_performance | Per-prompt-version validity/fallback/cost | PromptPerformanceSchema |

### ReliabilityScore
`reliabilityId, targetType (service|agent|capability|plan_type|repair_type|policy_rule), targetId,
score, sampleSize, successRate, failureRate, avgEvaluationScore, avgValidationScore, incidentRate,
repairSuccessRate, trend (improving|declining|stable|unknown), confidence, lastUpdatedAt`.

### OperationalPattern / SystemRecommendation
Pattern: `patternId, patternType (success|failure|weak_point), title, description, confidence,
supportCount, relatedRecords[], recommendedAction, status, …`. Recommendation: `recommendationId,
learningRunId, type (create_skill|update_skill|create_capability|improve_service|improve_policy|
improve_scoring|improve_prompt|deprecate_capability|add_monitor|add_validation|add_test), title,
reason, evidence[], relatedPatternIds[], expectedImpact, riskLevel, requiredApproval, status
(waiting_approval|approved|rejected|changes_requested|converted), convertedTo, convertedId, …`.

### MemorySummary / CompressedContext / PromptPerformance / LearningRun
Summary: `summaryId, scope, scopeId, timeWindow, sourceMemoryIds[], sourceEvidenceIds[], tokenBudget,
compressedText, keyFacts[], openQuestions[], nextActions[], …`. PromptPerformance: `promptKey,
promptVersion, taskType, sampleSize, validRate, fallbackRate, invalidRate, avgCostUsd, avgTokens,
recommendImprovement, reason, …`. LearningRun: `learningRunId, recordsAnalyzed, summary,
topSuccessPatterns[], topFailurePatterns[], weakServices[], weakCapabilities[], weakAgents[],
recommended*[], reliabilitySnapshotId, patternIds[], recommendationIds[], …`.

### Learning rule (enforced)
Learning **recommends**; approval applies. Recommendations are evidence-backed (source pattern +
support + related records), RBAC-gated (`approve_recommendation`), and audit-logged. Approving converts
a recommendation into a task/proposal. Synthetic test history is marked (`synthetic: true`) and never
mixed into production analysis intent. Future agents load `compressed_contexts` first.

## Phase 10 — Continuous Learning & Autonomous Improvement collections
| Collection | Purpose | Schema (shared/src/schemas/workflows.ts) |
|---|---|---|
| learning_schedules / learning_triggers | Continuous-ready learning cadence + fired triggers | LearningScheduleSchema / LearningTriggerSchema |
| improvement_workflows | Structured workflows converted from approved recommendations | ImprovementWorkflowSchema |
| impact_assessments | Before/after measurement of a completed workflow | ImpactAssessmentSchema |
| memory_maintenance_runs | Continuous memory compression passes | MemoryMaintenanceRunSchema |

### ImprovementWorkflow
`workflowId, sourceRecommendationId, taskId, type (create_skill|update_skill|create_capability|
improve_service|improve_policy|improve_scoring|improve_prompt|deprecate_capability|add_monitor|
add_validation|add_test), title, status (proposed|waiting_approval|approved|running|validating|
completed|failed|cancelled), steps[{name,engine,status,detail}], currentStep, requiredApprovals[],
evidenceIds[], result, beforeMetrics{}, afterMetrics{}, impactAssessmentId, …`.

### ImpactAssessment / MemoryMaintenanceRun / LearningSchedule
Impact: `impactAssessmentId, workflowId, targetType, targetId, beforeMetrics{}, afterMetrics{},
impact (reliability improved|incident rate reduced|validation score increased|fallback rate reduced|
plan prediction accuracy improved|no measurable improvement yet|…), confidence, evidenceIds[],
recommendation, …`. Maintenance: `maintenanceRunId, summariesReviewed, summariesUpdated,
summariesDeprecated, compressedContextsUpdated, tokenBudgetSaved, notes[], …`. Schedule:
`scheduleId, name, cadence, triggerType (time_based|new_incident_threshold|new_task_threshold|
new_evidence_threshold|low_reliability_detected|prompt_fallback_threshold|manual), enabled,
minNewRecords, scope, lastRunAt, nextRunAt, …`.

### Continuous-improvement rule (enforced)
Approval converts a recommendation into a structured workflow; execution runs only after approval and
routes through existing engines (skill library, builder/validation, scoring/policy proposals, strategic
planner, monitor, browser-testing). Impact is evidence-backed and never faked — "no measurable
improvement yet" is a valid honest result. Memory maintenance keeps the latest summary per scope and
deprecates the rest; future agents load compressed_contexts → active skills → reliability → patterns →
raw evidence last.
