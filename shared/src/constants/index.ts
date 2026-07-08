/**
 * Canonical system constants for the Autonomous OS Kernel.
 *
 * This file is the single source of truth for service identity, ports,
 * subdomains, MongoDB collection names, event types, and S3 key layout.
 * Every service and every doc references these names — do not hardcode
 * strings elsewhere.
 */

/** Root production domain. Subdomains are derived from this. */
export const ROOT_DOMAIN = 'simorx.com';

/** Stable service identifiers. Used as serviceId, folder name, Dokploy app name. */
export const SERVICE_IDS = {
  GATEWAY_API: 'gateway-api',
  DASHBOARD_WEB: 'dashboard-web',
  ORCHESTRATOR_AGENT: 'orchestrator-agent',
  ARCHITECT_AGENT: 'architect-agent',
  BUILDER_AGENT: 'builder-agent',
  DEVOPS_AGENT: 'devops-agent',
  REVIEWER_AGENT: 'reviewer-agent',
  QA_AGENT: 'qa-agent',
  MONITOR_AGENT: 'monitor-agent',
  MEMORY_AGENT: 'memory-agent',
  REPORT_AGENT: 'report-agent',
  DOCUMENTATION_SERVICE: 'documentation-service',
  SERVICE_REGISTRY: 'service-registry',
  EVENT_BUS_SERVICE: 'event-bus-service',
  FILE_ASSET_SERVICE: 'file-asset-service',
  INTERNET_RESEARCH_SERVICE: 'internet-research-service',
  BROWSER_TESTING_AGENT: 'browser-testing-agent',
  VOICE_OPERATOR_AGENT: 'voice-operator-agent',
  CODE_OPERATOR_AGENT: 'code-operator-agent',
} as const;

export type ServiceId = (typeof SERVICE_IDS)[keyof typeof SERVICE_IDS];

/**
 * Default local ports. Each service binds one port locally and is mapped to
 * its own subdomain in production via Dokploy. Ports are stable so local
 * service discovery and docs stay consistent.
 */
export const SERVICE_PORTS: Record<ServiceId, number> = {
  'dashboard-web': 4100,
  'gateway-api': 4101,
  'orchestrator-agent': 4102,
  'architect-agent': 4103,
  'builder-agent': 4104,
  'devops-agent': 4105,
  'reviewer-agent': 4106,
  'qa-agent': 4107,
  'service-registry': 4108,
  'memory-agent': 4109,
  'documentation-service': 4110,
  'event-bus-service': 4111,
  'file-asset-service': 4112,
  'monitor-agent': 4113,
  'report-agent': 4114,
  'internet-research-service': 4115,
  'browser-testing-agent': 4116,
  'voice-operator-agent': 4121,
  'code-operator-agent': 4122,
};

/** Production subdomain per service. Derived from ROOT_DOMAIN. */
export const SERVICE_SUBDOMAINS: Record<ServiceId, string> = {
  'gateway-api': `api.${ROOT_DOMAIN}`,
  'dashboard-web': `factory.${ROOT_DOMAIN}`,
  'orchestrator-agent': `orchestrator.${ROOT_DOMAIN}`,
  'architect-agent': `architect.${ROOT_DOMAIN}`,
  'builder-agent': `builder.${ROOT_DOMAIN}`,
  'devops-agent': `devops.${ROOT_DOMAIN}`,
  'reviewer-agent': `reviewer.${ROOT_DOMAIN}`,
  'qa-agent': `qa.${ROOT_DOMAIN}`,
  'monitor-agent': `monitor.${ROOT_DOMAIN}`,
  'memory-agent': `memory.${ROOT_DOMAIN}`,
  'report-agent': `reports.${ROOT_DOMAIN}`,
  'documentation-service': `docs.${ROOT_DOMAIN}`,
  'service-registry': `registry.${ROOT_DOMAIN}`,
  'event-bus-service': `events.${ROOT_DOMAIN}`,
  'file-asset-service': `assets.${ROOT_DOMAIN}`,
  'internet-research-service': `research.${ROOT_DOMAIN}`,
  'browser-testing-agent': `browser-testing.${ROOT_DOMAIN}`,
  'voice-operator-agent': `voice.${ROOT_DOMAIN}`,
  'code-operator-agent': `code.${ROOT_DOMAIN}`,
};

/** Classifies a service for the registry and dashboard. */
export const SERVICE_TYPES = {
  AGENT: 'agent',
  GATEWAY: 'gateway',
  WEB: 'web',
  INFRA: 'infra',
  INTEGRATION: 'integration',
} as const;

export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES];

/** Standard endpoint paths every factory service must expose. */
export const FACTORY_ENDPOINTS = {
  HEALTH: '/health',
  MANIFEST: '/.factory/manifest',
  STATUS: '/.factory/status',
  CAPABILITIES: '/.factory/capabilities',
  TASK: '/.factory/task',
  LOGS: '/.factory/logs',
} as const;

/** MongoDB Atlas collection names — the system's persistent state. */
export const COLLECTIONS = {
  USERS: 'users',
  SESSIONS: 'sessions',
  SERVICES: 'services',
  AGENTS: 'agents',
  TASKS: 'tasks',
  TASK_RUNS: 'task_runs',
  AGENT_RUNS: 'agent_runs',
  AGENT_MESSAGES: 'agent_messages',
  EVENTS: 'events',
  LOGS: 'logs',
  APPROVALS: 'approvals',
  INFRASTRUCTURE_REQUESTS: 'infrastructure_requests',
  MEMORIES: 'memories',
  SKILLS: 'skills',
  DOCUMENTS: 'documents',
  DECISION_LOGS: 'decision_logs',
  PHASE_LOGS: 'phase_logs',
  RESEARCH_REPORTS: 'research_reports',
  FILES: 'files',
  S3_OBJECTS: 's3_objects',
  DEPLOYMENTS: 'deployments',
  ENVIRONMENT_SPECS: 'environment_specs',
  SERVICE_MANIFESTS: 'service_manifests',
  API_CONTRACTS: 'api_contracts',
  COST_RECORDS: 'cost_records',
  SYSTEM_SETTINGS: 'system_settings',
  EVOLUTION_PROPOSALS: 'evolution_proposals',
  // Phase 3 — Self-Expanding Capability Engine
  CAPABILITIES: 'capabilities',
  CAPABILITY_GAPS: 'capability_gaps',
  CAPABILITY_EVALUATIONS: 'capability_evaluations',
  EXPANSION_PROPOSALS: 'expansion_proposals',
  LLM_TRACES: 'llm_traces',
  // Phase 4 — Reality Execution Layer
  RUNTIME_VALIDATIONS: 'runtime_validations',
  GITHUB_OPERATIONS: 'github_operations',
  EVIDENCE_RECORDS: 'evidence_records',
  // Phase 5 — Live Activation & Runtime Autonomy
  SERVICE_ACTIVATIONS: 'service_activations',
  DEPLOYMENT_CHECKLISTS: 'deployment_checklists',
  MONITOR_RUNS: 'monitor_runs',
  INCIDENTS: 'incidents',
  REPAIR_TASKS: 'repair_tasks',
  // Phase 6 — Autonomous Repair & Execution
  REPAIR_DIAGNOSES: 'repair_diagnoses',
  REPAIR_PLANS: 'repair_plans',
  // Phase 7 — Strategic Reasoning & Policy-Governed Execution
  STRATEGIC_PLANS: 'strategic_plans',
  PLAN_SCORES: 'plan_scores',
  POLICY_DECISIONS: 'policy_decisions',
  DECISION_MEMORIES: 'decision_memories',
  // Phase 8 — Learning Governance & Adaptive Intelligence
  OUTCOME_REVIEWS: 'outcome_reviews',
  SCORING_PROFILES: 'scoring_profiles',
  SCORING_CHANGE_PROPOSALS: 'scoring_change_proposals',
  POLICY_RULES: 'policy_rules',
  POLICY_PROFILES: 'policy_profiles',
  POLICY_CHANGE_PROPOSALS: 'policy_change_proposals',
  ROLES: 'roles',
  PERMISSIONS: 'permissions',
  AUDIT_LOGS: 'audit_logs',
  // Phase 9 — Operational Learning & Memory Intelligence
  LEARNING_RUNS: 'learning_runs',
  RELIABILITY_SCORES: 'reliability_scores',
  RELIABILITY_SNAPSHOTS: 'reliability_snapshots',
  OPERATIONAL_PATTERNS: 'operational_patterns',
  MEMORY_SUMMARIES: 'memory_summaries',
  COMPRESSED_CONTEXTS: 'compressed_contexts',
  SYSTEM_RECOMMENDATIONS: 'system_recommendations',
  PROMPT_PERFORMANCE: 'prompt_performance',
  // Phase 10 — Continuous Learning & Autonomous Improvement
  LEARNING_SCHEDULES: 'learning_schedules',
  LEARNING_TRIGGERS: 'learning_triggers',
  IMPROVEMENT_WORKFLOWS: 'improvement_workflows',
  IMPACT_ASSESSMENTS: 'impact_assessments',
  MEMORY_MAINTENANCE_RUNS: 'memory_maintenance_runs',
  // Phase 12 — Security, Auth & Production Hardening
  SECURITY_CHECKS: 'security_checks',
  SECURITY_EVENTS: 'security_events',
  // Phase 13 — Real Intelligence Integration
  LLM_COST_RECORDS: 'llm_cost_records',
  LLM_BUDGET_EVENTS: 'llm_budget_events',
  RESEARCH_RUNS: 'research_runs',
  RESEARCH_SOURCES: 'research_sources',
  REVIEW_REPORTS: 'review_reports',
  QA_REPORTS: 'qa_reports',
  INTELLIGENCE_REPORTS: 'intelligence_reports',
  // Phase 15 — Safe Real Operations
  OPERATION_PLANS: 'operation_plans',
  DOKPLOY_TARGETS: 'dokploy_targets',
  DEPLOYMENT_SNAPSHOTS: 'deployment_snapshots',
  // Phase 17 — Dokploy Calibration
  DOKPLOY_API_DIAGNOSTICS: 'dokploy_api_diagnostics',
  // Phase 18 — Realtime Voice Operator
  VOICE_SESSIONS: 'voice_sessions',
  VOICE_MESSAGES: 'voice_messages',
  VOICE_TOOL_CALLS: 'voice_tool_calls',
  VOICE_PERMISSIONS: 'voice_permissions',
  VOICE_MEMORIES: 'voice_memories',
  VOICE_LEARNING_EVENTS: 'voice_learning_events',
  // Phase X — Autonomous Operator Runtime
  OPERATOR_TOOLS: 'operator_tools',
  OPERATOR_TOOL_RUNS: 'operator_tool_runs',
  OPERATOR_TOOL_PERMISSIONS: 'operator_tool_permissions',
  OPERATOR_RUNTIME_SESSIONS: 'operator_runtime_sessions',
  OPERATOR_RUNTIME_STEPS: 'operator_runtime_steps',
  OPERATOR_RUNTIME_MEMORIES: 'operator_runtime_memories',
  OPERATOR_CAPABILITY_INDEX: 'operator_capability_index',
  // Phase Y — Autonomous Staging Workspace & Service Evolution Runtime
  WORKSPACES: 'workspaces',
  WORKSPACE_RUNS: 'workspace_runs',
  WORKSPACE_SERVICES: 'workspace_services',
  WORKSPACE_CHANGES: 'workspace_changes',
  WORKSPACE_TESTS: 'workspace_tests',
  WORKSPACE_ARTIFACTS: 'workspace_artifacts',
  WORKSPACE_MIGRATIONS: 'workspace_migrations',
  WORKSPACE_ROLLBACKS: 'workspace_rollbacks',
  // Phase AA — Scope, Identity & Multi-Tenant Governance
  TENANTS: 'tenants',
  USER_PROFILES: 'user_profiles',
  TENANT_MEMBERSHIPS: 'tenant_memberships',
  USER_ROLES: 'user_roles',
  SCOPE_POLICIES: 'scope_policies',
  CONSENT_GRANTS: 'consent_grants',
  CONNECTOR_ACCOUNTS: 'connector_accounts',
  CONNECTOR_SYNC_RUNS: 'connector_sync_runs',
  SCOPED_MEMORIES: 'scoped_memories',
  USER_GOALS: 'user_goals',
  USER_CONSTRAINTS: 'user_constraints',
  DAILY_BRIEFINGS: 'daily_briefings',
  WEEKLY_STRATEGY_REVIEWS: 'weekly_strategy_reviews',
  OPPORTUNITY_REPORTS: 'opportunity_reports',
  PUBLIC_SERVICE_CASES: 'public_service_cases',
  ACCESS_DECISIONS: 'access_decisions',
  // Phase AB — Personal Reality Baseline & Jarvis Intelligence Layer
  // (personal goals live in USER_GOALS from Phase AA — one source of truth)
  PERSONAL_REALITY_PROFILES: 'personal_reality_profiles',
  PERSONAL_ASSETS: 'personal_assets',
  PERSONAL_PROJECTS: 'personal_projects',
  PERSONAL_SYSTEMS: 'personal_systems',
  PERSONAL_RISKS: 'personal_risks',
  PERSONAL_OPPORTUNITIES: 'personal_opportunities',
  PERSONAL_INCOME_STREAMS: 'personal_income_streams',
  PERSONAL_LEARNING_TRACKS: 'personal_learning_tracks',
  PERSONAL_CAREER_RECORDS: 'personal_career_records',
  RESUME_PROFILES: 'resume_profiles',
  TECHNOLOGY_WATCH_ITEMS: 'technology_watch_items',
  NEXT_BEST_ACTIONS: 'next_best_actions',
  PERSONAL_BRIEFING_RUNS: 'personal_briefing_runs',
  STRATEGY_REVIEW_RUNS: 'strategy_review_runs',
  // Phase AC+ — Command Universe domains
  PERSONAL_HEALTH_STATES: 'personal_health_states',
  PERSONAL_LIFE_ITEMS: 'personal_life_items',
  PERSONAL_FINANCE_ITEMS: 'personal_finance_items',
  // Phase AD — Jarvis Intelligence Core & Living Command Home
  JARVIS_TURNS: 'jarvis_turns',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * Canonical event type names streamed over the event bus and persisted in the
 * `events` collection. Naming convention: <domain>.<thing>.<pastTenseVerb>.
 */
export const EVENT_TYPES = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  AGENT_RUN_STARTED: 'agent.run.started',
  AGENT_RUN_STEP: 'agent.run.step',
  AGENT_RUN_FINISHED: 'agent.run.finished',
  AGENT_LOG: 'agent.log',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_DECIDED: 'approval.decided',
  INFRA_REQUEST_CREATED: 'infra.request.created',
  INFRA_REQUEST_FULFILLED: 'infra.request.fulfilled',
  SERVICE_REGISTERED: 'service.registered',
  SERVICE_HEALTH_CHANGED: 'service.health.changed',
  MEMORY_WRITTEN: 'memory.written',
  DOC_UPDATED: 'doc.updated',
  RESEARCH_COMPLETED: 'research.completed',
  EVOLUTION_PROPOSED: 'evolution.proposed',
  // Phase 3 — Self-Expanding Capability Engine
  CAPABILITY_ANALYZED: 'capability.analyzed',
  CAPABILITY_GAP_DETECTED: 'capability.gap.detected',
  CAPABILITY_REGISTERED: 'capability.registered',
  EXPANSION_PROPOSED: 'expansion.proposed',
  EXPANSION_DECIDED: 'expansion.decided',
  SERVICE_SCAFFOLDED: 'service.scaffolded',
  EVALUATION_CREATED: 'evaluation.created',
  SKILL_CREATED: 'skill.created',
  SKILL_UPDATED: 'skill.updated',
  LLM_TRACE_RECORDED: 'llm.trace.recorded',
  // Phase 4 — Reality Execution Layer
  VALIDATION_STARTED: 'validation.started',
  VALIDATION_COMPLETED: 'validation.completed',
  EVIDENCE_RECORDED: 'evidence.recorded',
  GITHUB_OPERATION: 'github.operation',
  CAPABILITY_VALIDATED: 'capability.validated',
  CAPABILITY_ACTIVATED: 'capability.activated',
  BROWSER_TEST_COMPLETED: 'browser.test.completed',
  // Phase 5 — Live Activation & Runtime Autonomy
  ACTIVATION_STARTED: 'activation.started',
  ACTIVATION_COMPLETED: 'activation.completed',
  CHECKLIST_CREATED: 'checklist.created',
  MONITOR_RUN: 'monitor.run',
  INCIDENT_CREATED: 'incident.created',
  REPAIR_TASK_CREATED: 'repair.task.created',
  // Phase 6 — Autonomous Repair & Execution
  DIAGNOSIS_CREATED: 'repair.diagnosis.created',
  REPAIR_PLAN_CREATED: 'repair.plan.created',
  REPAIR_EXECUTED: 'repair.executed',
  INCIDENT_RESOLVED: 'incident.resolved',
  // Phase 7 — Strategic Reasoning & Policy-Governed Execution
  PLANS_GENERATED: 'reasoning.plans.generated',
  PLAN_SCORED: 'reasoning.plan.scored',
  PLAN_SELECTED: 'reasoning.plan.selected',
  POLICY_DECISION: 'reasoning.policy.decision',
  DECISION_RECORDED: 'reasoning.decision.recorded',
  // Phase 8 — Learning Governance & Adaptive Intelligence
  OUTCOME_REVIEWED: 'governance.outcome.reviewed',
  SCORING_PROPOSAL_CREATED: 'governance.scoring.proposed',
  SCORING_PROFILE_ACTIVATED: 'governance.scoring.activated',
  POLICY_PROPOSAL_CREATED: 'governance.policy.proposed',
  POLICY_PROFILE_ACTIVATED: 'governance.policy.activated',
  AUDIT_LOGGED: 'governance.audit.logged',
  ROLE_CHANGED: 'governance.role.changed',
  // Phase 9 — Operational Learning & Memory Intelligence
  LEARNING_RUN_COMPLETED: 'learning.run.completed',
  RELIABILITY_UPDATED: 'learning.reliability.updated',
  PATTERN_DETECTED: 'learning.pattern.detected',
  MEMORY_SUMMARIZED: 'learning.memory.summarized',
  RECOMMENDATION_CREATED: 'learning.recommendation.created',
  RECOMMENDATION_DECIDED: 'learning.recommendation.decided',
  PROMPT_PERFORMANCE_UPDATED: 'learning.prompt.updated',
  // Phase 10 — Continuous Learning & Autonomous Improvement
  LEARNING_TRIGGERED: 'improve.learning.triggered',
  WORKFLOW_CREATED: 'improve.workflow.created',
  WORKFLOW_STEP: 'improve.workflow.step',
  WORKFLOW_COMPLETED: 'improve.workflow.completed',
  IMPACT_ASSESSED: 'improve.impact.assessed',
  MEMORY_MAINTAINED: 'improve.memory.maintained',
  // Phase 12 — Security, Auth & Production Hardening
  LOGIN_SUCCEEDED: 'security.login.succeeded',
  LOGIN_FAILED: 'security.login.failed',
  LOGOUT: 'security.logout',
  RBAC_DENIED: 'security.rbac.denied',
  AUTH_FAILED: 'security.auth.failed',
  RATE_LIMITED: 'security.rate.limited',
  SECURITY_CHECK_COMPLETED: 'security.check.completed',
  SAFE_MODE_CHANGED: 'security.safe_mode.changed',
  // Phase 13 — Real Intelligence Integration
  RESEARCH_COMPLETED_V2: 'intel.research.completed',
  REVIEW_COMPLETED: 'intel.review.completed',
  QA_COMPLETED: 'intel.qa.completed',
  REPORT_GENERATED: 'intel.report.generated',
  LLM_BUDGET_EXCEEDED: 'intel.llm.budget',
  // Phase 15 — Safe Real Operations
  OPERATION_CREATED: 'ops.operation.created',
  OPERATION_UPDATED: 'ops.operation.updated',
  OPERATION_APPROVED: 'ops.operation.approved',
  OPERATION_EXECUTED: 'ops.operation.executed',
  OPERATION_VERIFIED: 'ops.operation.verified',
  OPERATION_COMPLETED: 'ops.operation.completed',
  // Phase 18 — Realtime Voice Operator
  VOICE_SESSION_STARTED: 'voice.session.started',
  VOICE_TOOL_PROPOSED: 'voice.tool.proposed',
  VOICE_TOOL_EXECUTED: 'voice.tool.executed',
  VOICE_PERMISSION_REQUESTED: 'voice.permission.requested',
  VOICE_PERMISSION_DECIDED: 'voice.permission.decided',
  VOICE_LEARNED: 'voice.learned',
  // Phase 19 — Full Realtime Voice WebRTC
  VOICE_REALTIME_CONNECTED: 'voice.realtime.connected',
  VOICE_REALTIME_DISCONNECTED: 'voice.realtime.disconnected',
  VOICE_SESSION_ENDED: 'voice.session.ended',
  // Phase X — Autonomous Operator Runtime
  OPERATOR_SESSION_STARTED: 'operator.session.started',
  OPERATOR_STEP_COMPLETED: 'operator.step.completed',
  OPERATOR_TOOL_EXECUTED: 'operator.tool.executed',
  OPERATOR_TOOL_FAILED: 'operator.tool.failed',
  OPERATOR_APPROVAL_REQUESTED: 'operator.approval.requested',
  OPERATOR_SESSION_COMPLETED: 'operator.session.completed',
  OPERATOR_MEMORY_WRITTEN: 'operator.memory.written',
  // Phase Y — workspace evolution runtime
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_ITERATION: 'workspace.iteration',
  WORKSPACE_CHECK_COMPLETED: 'workspace.check.completed',
  WORKSPACE_SERVICE_STARTED: 'workspace.service.started',
  WORKSPACE_VERIFIED: 'workspace.verified',
  WORKSPACE_MIGRATION_PROPOSED: 'workspace.migration.proposed',
  WORKSPACE_PROMOTED: 'workspace.promoted',
  WORKSPACE_ROLLED_BACK: 'workspace.rolled_back',
  WORKSPACE_FAILED: 'workspace.failed',
  // Phase AA — identity, consent, access
  IDENTITY_SEEDED: 'identity.seeded',
  ACCESS_DENIED: 'access.denied',
  ACCESS_APPROVAL_REQUIRED: 'access.approval_required',
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_REVOKED: 'consent.revoked',
  CONNECTOR_SYNC_BLOCKED: 'connector.sync.blocked',
  SCOPED_MEMORY_WRITTEN: 'scoped.memory.written',
  // Phase AD — Jarvis Intelligence Core & Living Command Home
  JARVIS_TURN_ANSWERED: 'jarvis.turn.answered',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * S3 key prefixes. Every object lives under one of these. Pattern:
 *   factory/<area>/<id>/...
 */
export const S3_PREFIXES = {
  ROOT: 'factory',
  services: (serviceId: string) => `factory/services/${serviceId}`,
  agents: (agentId: string) => `factory/agents/${agentId}`,
  tasks: (taskId: string) => `factory/tasks/${taskId}`,
  documents: () => `factory/documents`,
  artifacts: () => `factory/artifacts`,
  images: () => `factory/images`,
  logs: () => `factory/logs`,
  research: () => `factory/research`,
} as const;

/** Header used to carry the internal service-to-service token. */
export const INTERNAL_TOKEN_HEADER = 'x-factory-internal-token';
/** Header used to carry the privileged admin token. */
export const ADMIN_TOKEN_HEADER = 'x-factory-admin-token';
/**
 * Header the trusted dashboard server sets to declare the authenticated user's
 * role. Only honored by the gateway when accompanied by a valid admin token, so
 * an untrusted client cannot self-elevate.
 */
export const ROLE_HEADER = 'x-factory-role';
/** Request id echoed in responses and error envelopes for traceability. */
export const REQUEST_ID_HEADER = 'x-request-id';

export const SERVICE_VERSION = '0.1.0';
