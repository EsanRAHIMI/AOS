/**
 * Server-only gateway client. Runs in Next.js server components / route
 * handlers. The admin token lives in the server environment and is never
 * exposed to the browser.
 */
import 'server-only';

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-factory-admin-token': ADMIN,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<T>;
    return body.data ?? null;
  } catch {
    return null;
  }
}

export const gateway = {
  tasks: () => call<unknown[]>('/v1/tasks'),
  task: (id: string) => call<unknown>(`/v1/tasks/${id}`),
  taskTimeline: (id: string) => call<unknown[]>(`/v1/tasks/${id}/timeline`),
  services: () => call<unknown[]>('/v1/services'),
  approvals: () => call<unknown[]>('/v1/approvals'),
  infrastructure: () => call<unknown[]>('/v1/infrastructure'),
  events: (limit = 100) => call<unknown[]>(`/v1/events?limit=${limit}`),
  systemStatus: () => call<{ taskCount: number; pendingApprovals: number; env: string }>('/v1/system/status'),
  createTask: (goal: string) =>
    call<{ taskId?: string }>('/v1/tasks', { method: 'POST', body: JSON.stringify({ goal }) }),
  decideApproval: (id: string, action: string, reason?: string) =>
    call<unknown>(`/v1/approvals/${id}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  confirmInfra: (id: string) =>
    call<unknown>(`/v1/infrastructure/${id}/confirm`, { method: 'POST' }),
  // Phase 3 — Self-Expanding Capability Engine
  capabilities: () => call<unknown[]>('/v1/capabilities'),
  capability: (id: string) => call<unknown>(`/v1/capabilities/${id}`),
  gaps: () => call<unknown[]>('/v1/gaps'),
  expansionProposals: () => call<unknown[]>('/v1/expansion-proposals'),
  evaluations: () => call<unknown[]>('/v1/evaluations'),
  skills: () => call<unknown[]>('/v1/skills'),
  llmTraces: (limit = 100) => call<unknown[]>(`/v1/llm-traces?limit=${limit}`),
  decideExpansion: (id: string, action: string, reason?: string) =>
    call<{ buildTaskId?: string }>(`/v1/expansion-proposals/${id}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  // Phase 4 — Reality Execution Layer
  validations: () => call<unknown[]>('/v1/validations'),
  validation: (id: string) => call<{ validation: unknown; evidence: unknown[] }>(`/v1/validations/${id}`),
  githubOps: () => call<unknown[]>('/v1/github'),
  evidence: (query = '') => call<unknown[]>(`/v1/evidence${query}`),
  // Phase 5 — Live Activation & Runtime Autonomy
  activations: () => call<unknown[]>('/v1/activations'),
  activation: (id: string) => call<{ activation: unknown; evidence: unknown[] }>(`/v1/activations/${id}`),
  checklists: () => call<unknown[]>('/v1/checklists'),
  confirmChecklist: (id: string) => call<unknown>(`/v1/checklists/${id}/confirm`, { method: 'POST' }),
  runActivation: (id: string, baseUrl?: string) =>
    call<{ activation?: { passed?: boolean } }>(`/v1/checklists/${id}/activate`, { method: 'POST', body: JSON.stringify({ baseUrl }) }),
  monitor: () => call<unknown[]>('/v1/monitor'),
  incidents: () => call<unknown[]>('/v1/incidents'),
  repairTasks: () => call<unknown[]>('/v1/repair-tasks'),
  // Phase 6 — Autonomous Repair & Execution
  incidentDetail: (id: string) => call<{ incident: unknown; diagnosis: unknown; plan: unknown; repairTask: unknown; evidence: unknown[] }>(`/v1/incidents/${id}`),
  repairTaskDetail: (id: string) => call<unknown>(`/v1/repair-tasks/${id}`),
  repairDiagnoses: () => call<unknown[]>('/v1/repair-diagnoses'),
  repairPlans: () => call<unknown[]>('/v1/repair-plans'),
  decideRepairPlan: (id: string, action: string, baseUrl?: string) =>
    call<{ repair?: { resolved?: boolean } }>(`/v1/repair-plans/${id}/decision`, { method: 'POST', body: JSON.stringify({ action, baseUrl }) }),
  revalidateIncident: (id: string, baseUrl?: string) =>
    call<{ repair?: { resolved?: boolean } }>(`/v1/incidents/${id}/revalidate`, { method: 'POST', body: JSON.stringify({ baseUrl }) }),
  integrations: () => call<{ github: { configured: boolean; mode: string }; llm: { provider: string; mode: string; configured: boolean; defaultProvider: string } }>('/v1/system/integrations'),
  llmStatus: () => call<{ status: { provider: string; mode: string }; traceCount: number; realCount: number; fallbackCount: number; invalidCount: number; totalCostUsd: number }>('/v1/llm/status'),
  // Phase 7 — Strategic Reasoning & Policy
  strategicPlans: (taskId?: string) => call<unknown[]>(`/v1/strategic-plans${taskId ? `?taskId=${taskId}` : ''}`),
  strategicPlan: (id: string) => call<{ plan: unknown; score: unknown }>(`/v1/strategic-plans/${id}`),
  planScores: (taskId?: string) => call<unknown[]>(`/v1/plan-scores${taskId ? `?taskId=${taskId}` : ''}`),
  policyDecisions: (taskId?: string) => call<unknown[]>(`/v1/policy-decisions${taskId ? `?taskId=${taskId}` : ''}`),
  decisionMemory: (taskId?: string) => call<unknown[]>(`/v1/decision-memory${taskId ? `?taskId=${taskId}` : ''}`),
  llmTrace: (id: string) => call<unknown>(`/v1/llm-traces/${id}`),
  // Phase 8 — Learning Governance & Adaptive Intelligence
  outcomeReviews: () => call<unknown[]>('/v1/outcome-reviews'),
  scoringProfiles: () => call<unknown[]>('/v1/scoring-profiles'),
  scoringProposals: () => call<unknown[]>('/v1/scoring-change-proposals'),
  policyRules: () => call<unknown[]>('/v1/policy-rules'),
  policyProposals: () => call<unknown[]>('/v1/policy-change-proposals'),
  rbac: () => call<{ roles: unknown[]; permissions: unknown[]; users: unknown[] }>('/v1/rbac'),
  auditLogs: () => call<unknown[]>('/v1/audit-logs'),
  decideScoringProposal: (id: string, action: string) =>
    call<{ activated?: boolean; profileVersion?: number }>(`/v1/scoring-change-proposals/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) }),
  decidePolicyProposal: (id: string, action: string) =>
    call<{ activated?: boolean }>(`/v1/policy-change-proposals/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) }),
};
