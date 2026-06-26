/**
 * Capability catalog + deterministic capability reasoning.
 *
 * The capability graph models what the kernel can do. This module seeds the
 * graph with the kernel's current abilities, maps free-text goals to required
 * capabilities (the deterministic fallback used when no LLM is configured), and
 * templates an expansion proposal for a missing capability.
 */
import { nowIso, genId } from '../utils/index.js';
import type { Capability } from '../schemas/capability.js';

/** The kernel's built-in capabilities as of Phase 3. Seeded on startup. */
type SeedCapability = Pick<
  Capability,
  'capabilityId' | 'title' | 'description' | 'category' | 'supportedByServices' | 'supportedByAgents' | 'requiredPermissions' | 'maturityLevel' | 'riskLevel' | 'evaluationScore'
> & { seedStatus?: Capability['status']; supportedByTools?: string[] };

export const CAPABILITY_CATALOG: SeedCapability[] = [
  {
    capabilityId: 'cap_task_orchestration',
    title: 'Orchestrate a goal into delegated work',
    description: 'Decompose a goal and delegate to specialist services with a live timeline.',
    category: 'orchestration',
    supportedByServices: ['orchestrator-agent', 'gateway-api', 'event-bus-service'],
    supportedByAgents: ['orchestrator-agent'],
    requiredPermissions: ['create_task', 'delegate_task'],
    maturityLevel: 'stable',
    riskLevel: 'low',
    evaluationScore: 0.85,
  },
  {
    capabilityId: 'cap_service_generation',
    title: 'Generate a new independent service',
    description: 'Scaffold a standard factory service/agent from templates and contracts.',
    category: 'self_expansion',
    supportedByServices: ['builder-agent', 'architect-agent', 'documentation-service'],
    supportedByAgents: ['orchestrator-agent', 'builder-agent'],
    requiredPermissions: ['create_code', 'request_infrastructure'],
    maturityLevel: 'early',
    riskLevel: 'medium',
    evaluationScore: 0.7,
  },
  {
    capabilityId: 'cap_infrastructure_request',
    title: 'Generate Dokploy infrastructure requests',
    description: 'Produce exact app specs for human creation in Dokploy; never assumes host control.',
    category: 'deployment',
    supportedByServices: ['devops-agent'],
    supportedByAgents: ['devops-agent'],
    requiredPermissions: ['request_infrastructure'],
    maturityLevel: 'stable',
    riskLevel: 'medium',
    evaluationScore: 0.8,
  },
  {
    capabilityId: 'cap_documentation',
    title: 'Maintain living documentation',
    description: 'Append phase/decision logs and per-task docs automatically.',
    category: 'documentation',
    supportedByServices: ['documentation-service'],
    supportedByAgents: [],
    requiredPermissions: ['write_docs'],
    maturityLevel: 'stable',
    riskLevel: 'low',
    evaluationScore: 0.82,
  },
  {
    capabilityId: 'cap_memory',
    title: 'Store reusable memory and skills',
    description: 'Persist compact task memories and extract reusable skills.',
    category: 'learning',
    supportedByServices: ['memory-agent'],
    supportedByAgents: ['memory-agent'],
    requiredPermissions: ['write_memory'],
    maturityLevel: 'early',
    riskLevel: 'low',
    evaluationScore: 0.72,
  },
  {
    capabilityId: 'cap_approval_governance',
    title: 'Gate sensitive actions on human approval',
    description: 'Create approvals and drive tasks from human decisions; every decision logged.',
    category: 'governance',
    supportedByServices: ['gateway-api'],
    supportedByAgents: ['orchestrator-agent'],
    requiredPermissions: ['request_approval'],
    maturityLevel: 'stable',
    riskLevel: 'low',
    evaluationScore: 0.88,
  },
  {
    capabilityId: 'cap_event_streaming',
    title: 'Stream live system events',
    description: 'Persist and fan out events over SSE for the live dashboard.',
    category: 'observability',
    supportedByServices: ['event-bus-service'],
    supportedByAgents: [],
    requiredPermissions: [],
    maturityLevel: 'stable',
    riskLevel: 'low',
    evaluationScore: 0.85,
  },
  {
    capabilityId: 'cap_file_storage',
    title: 'Store files and artifacts on S3',
    description: 'Presigned upload/download with MongoDB-tracked metadata.',
    category: 'storage',
    supportedByServices: ['file-asset-service'],
    supportedByAgents: [],
    requiredPermissions: ['write_files'],
    maturityLevel: 'early',
    riskLevel: 'low',
    evaluationScore: 0.7,
  },
  {
    // Generated in Phase 3; activated (validated → active) in Phase 4.
    capabilityId: 'browser_testing',
    title: 'Validate UI in a real browser',
    description: 'Open a URL and assert title/status/text/selector; capture a screenshot.',
    category: 'testing',
    supportedByServices: ['browser-testing-agent'],
    supportedByAgents: ['browser-testing-agent'],
    supportedByTools: ['Playwright'],
    requiredPermissions: ['run_browser'],
    maturityLevel: 'early',
    riskLevel: 'medium',
    evaluationScore: 0.7,
    seedStatus: 'generated',
  },
];

/** Build full Capability docs (with timestamps) for seeding. */
export function buildSeedCapabilities(): Capability[] {
  const now = nowIso();
  return CAPABILITY_CATALOG.map(({ seedStatus, supportedByTools, ...c }) => ({
    ...c,
    supportedByTools: supportedByTools ?? [],
    requiredEnv: [],
    relatedDocs: [],
    relatedMemories: [],
    status: seedStatus ?? 'active',
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Deterministic goal → required-capability mapping. This is the fallback used
 * when no LLM is configured (and to validate LLM output). Keyword-driven.
 */
const CAPABILITY_KEYWORDS: Array<{ capabilityId: string; keywords: string[] }> = [
  { capabilityId: 'browser_testing', keywords: ['browser', 'playwright', 'ui test', 'e2e', 'end-to-end', 'selenium', 'frontend test', 'browser testing'] },
  { capabilityId: 'cap_service_generation', keywords: ['create service', 'new service', 'scaffold', 'generate service', 'build a service', 'add a service'] },
  { capabilityId: 'cap_infrastructure_request', keywords: ['deploy', 'dokploy', 'infrastructure', 'container', 'subdomain'] },
  { capabilityId: 'cap_documentation', keywords: ['document', 'docs', 'documentation'] },
  { capabilityId: 'cap_memory', keywords: ['remember', 'memory', 'learn'] },
  { capabilityId: 'email_integration', keywords: ['email', 'smtp', 'send mail', 'notification email'] },
  { capabilityId: 'web_research', keywords: ['research', 'search the web', 'internet', 'web search'] },
  { capabilityId: 'data_analysis', keywords: ['analy', 'report metrics', 'dashboard chart', 'aggregate data'] },
];

export function detectRequiredCapabilities(goal: string): string[] {
  const g = goal.toLowerCase();
  const found = new Set<string>();
  for (const { capabilityId, keywords } of CAPABILITY_KEYWORDS) {
    if (keywords.some((k) => g.includes(k))) found.add(capabilityId);
  }
  // Always require orchestration; goals are executed by the orchestrator.
  found.add('cap_task_orchestration');
  return [...found];
}

/** Known templates for proposing how to fill a missing capability. */
const EXPANSION_TEMPLATES: Record<
  string,
  { serviceName: string; agentName: string | null; toolName: string | null; reason: string; impact: string; permissions: string[]; risk: 'low' | 'medium' | 'high' }
> = {
  browser_testing: {
    serviceName: 'browser-testing-agent',
    agentName: 'browser-testing-agent',
    toolName: 'Playwright',
    reason: 'The kernel needs real browser validation for dashboard and service UI tasks.',
    impact: 'Enables autonomous UI testing and regression checks.',
    permissions: ['run_browser', 'create_test_report'],
    risk: 'medium',
  },
  email_integration: {
    serviceName: 'email-integration-service',
    agentName: null,
    toolName: 'SMTP/Resend',
    reason: 'The kernel needs to send transactional emails/notifications.',
    impact: 'Enables outbound email as a governed action.',
    permissions: ['send_email'],
    risk: 'high',
  },
  web_research: {
    serviceName: 'internet-research-service',
    agentName: 'internet-research-service',
    toolName: 'Web search',
    reason: 'The kernel needs current information from trusted online sources.',
    impact: 'Reduces outdated assumptions; supports troubleshooting.',
    permissions: ['web_fetch'],
    risk: 'medium',
  },
  data_analysis: {
    serviceName: 'analysis-agent',
    agentName: 'analysis-agent',
    toolName: null,
    reason: 'The kernel needs to analyze and summarize structured data.',
    impact: 'Enables metrics analysis and reporting.',
    permissions: ['read_data'],
    risk: 'low',
  },
};

export interface ExpansionTemplate {
  serviceName: string;
  agentName: string | null;
  toolName: string | null;
  reason: string;
  impact: string;
  permissions: string[];
  risk: 'low' | 'medium' | 'high';
}

export function templateForCapability(capabilityId: string): ExpansionTemplate {
  const t = EXPANSION_TEMPLATES[capabilityId];
  if (t) return t;
  const slug = capabilityId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    serviceName: `${slug}-service`,
    agentName: null,
    toolName: null,
    reason: `The kernel needs the "${capabilityId}" capability to fulfill this class of goals.`,
    impact: `Adds "${capabilityId}" to the capability graph for future tasks.`,
    permissions: [],
    risk: 'medium',
  };
}

/** Human-readable title for a capability id (best-effort). */
export function capabilityTitle(capabilityId: string): string {
  const known = CAPABILITY_CATALOG.find((c) => c.capabilityId === capabilityId);
  if (known) return known.title;
  return capabilityId.replace(/^cap_/, '').replace(/_/g, ' ');
}

export { genId as genCapabilityId };
