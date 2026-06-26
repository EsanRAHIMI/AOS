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

export const SERVICE_VERSION = '0.1.0';
