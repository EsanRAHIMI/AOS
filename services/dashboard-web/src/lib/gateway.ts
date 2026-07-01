/**
 * Server-only gateway client. Runs in Next.js server components / route
 * handlers. The admin token lives in the server environment and is never
 * exposed to the browser.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, sessionSecret } from './session';

const API = process.env.FACTORY_API_URL ?? 'http://localhost:4101';
const ADMIN = process.env.FACTORY_ADMIN_TOKEN ?? '';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Declare the logged-in user's role to the gateway. Only meaningful alongside
 * the admin token (server-side), so the gateway records the true actor and
 * enforces RBAC. Derived from the signed session — never from client input.
 */
async function roleHeader(): Promise<Record<string, string>> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token, sessionSecret()) : null;
    return session ? { 'x-factory-role': session.role } : {};
  } catch {
    return {};
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-factory-admin-token': ADMIN,
        ...(await roleHeader()),
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
  // Phase 9 — Operational Learning & Memory Intelligence
  learningRuns: () => call<unknown[]>('/v1/learning-runs'),
  reliability: () => call<unknown[]>('/v1/reliability'),
  patterns: () => call<unknown[]>('/v1/patterns'),
  memorySummaries: () => call<unknown[]>('/v1/memory-summaries'),
  compressedContexts: () => call<unknown[]>('/v1/compressed-contexts'),
  systemRecommendations: () => call<unknown[]>('/v1/system-recommendations'),
  promptPerformance: () => call<unknown[]>('/v1/prompt-performance'),
  decideRecommendation: (id: string, action: string) =>
    call<{ approved?: boolean; taskId?: string }>(`/v1/system-recommendations/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) }),
  // Phase 10 — Continuous Learning & Autonomous Improvement
  learningSchedules: () => call<unknown[]>('/v1/learning/schedules'),
  learningTriggers: () => call<unknown[]>('/v1/learning/triggers'),
  improvementWorkflows: () => call<unknown[]>('/v1/improvement-workflows'),
  improvementWorkflow: (id: string) => call<{ workflow: unknown; impact: unknown; evidence: unknown[] }>(`/v1/improvement-workflows/${id}`),
  impactAssessments: () => call<unknown[]>('/v1/impact-assessments'),
  memoryMaintenance: () => call<unknown[]>('/v1/memory-maintenance'),
  triggerLearning: (type?: string, reason?: string) =>
    call<{ triggered?: boolean; taskId?: string }>('/v1/learning/trigger', { method: 'POST', body: JSON.stringify({ type, reason }) }),
  // Phase 12 — Security, Auth & Production Hardening
  securityChecks: () => call<unknown[]>('/v1/security/checks'),
  runSecurityCheck: () => call<{ checkId?: string; passed?: boolean; riskLevel?: string }>('/v1/security/check', { method: 'POST' }),
  securityEvents: (limit = 100) => call<unknown[]>(`/v1/security/events?limit=${limit}`),
  securityEnv: () => call<{ checks: Array<{ id: string; label: string; passed: boolean; severity: string; detail: string }>; passed: boolean; riskLevel: string; recommendations: string[]; safeMode: boolean }>('/v1/security/env'),
  safeMode: () => call<{ enabled: boolean }>('/v1/security/safe-mode'),
  setSafeMode: (enabled: boolean) => call<{ enabled: boolean }>('/v1/security/safe-mode', { method: 'POST', body: JSON.stringify({ enabled }) }),
  rateLimits: () => call<{ buckets: Array<{ key: string; count: number; resetAt: string }> }>('/v1/security/rate-limits'),
  reportSecurityEvent: (e: { eventType: string; actorId?: string; role?: string; result?: string; target?: string; detail?: string; riskLevel?: string }) =>
    call<unknown>('/v1/security/event', { method: 'POST', body: JSON.stringify(e) }),
  // Phase 13 — Real Intelligence Integration
  llmCosts: () => call<{ status: { provider: string; mode: string }; totals: { today: number; allTime: number; calls: number; realCount: number; fallbackCount: number }; byProvider: Record<string, { calls: number; costUsd: number }>; byAgent: Record<string, { calls: number; costUsd: number }>; mostExpensiveTask: { taskId: string; costUsd: number } | null; recent: Array<Record<string, unknown>> }>('/v1/llm/costs'),
  llmPrompts: () => call<unknown[]>('/v1/llm/prompts'),
  llmBudgetEvents: () => call<unknown[]>('/v1/llm/budget-events'),
  research: (taskId?: string) => call<unknown[]>(`/v1/research${taskId ? `?taskId=${taskId}` : ''}`),
  researchDetail: (id: string) => call<{ report: Record<string, unknown>; run: Record<string, unknown>; sources: Array<Record<string, unknown>> }>(`/v1/research/${id}`),
  reviews: (taskId?: string) => call<unknown[]>(`/v1/reviews${taskId ? `?taskId=${taskId}` : ''}`),
  qa: (taskId?: string) => call<unknown[]>(`/v1/qa${taskId ? `?taskId=${taskId}` : ''}`),
  reports: (taskId?: string) => call<unknown[]>(`/v1/reports${taskId ? `?taskId=${taskId}` : ''}`),
  // Phase 15 — Safe Real Operations
  operations: () => call<unknown[]>('/v1/operations'),
  activeOperation: () => call<Record<string, unknown> | null>('/v1/operations/active'),
  operation: (id: string) => call<{ plan: Record<string, unknown>; snapshot: Record<string, unknown> | null; target: Record<string, unknown> | null }>(`/v1/operations/${id}`),
  dokployTargets: () => call<unknown[]>('/v1/dokploy-targets'),
  createOperation: (goal: string, operationType: string) => call<{ operationPlanId?: string }>('/v1/operations', { method: 'POST', body: JSON.stringify({ goal, operationType }) }),
  confirmOperationTarget: (id: string, target: Record<string, unknown>) => call<Record<string, unknown>>(`/v1/operations/${id}/target`, { method: 'POST', body: JSON.stringify(target) }),
  decideOperation: (id: string, action: string) => call<Record<string, unknown>>(`/v1/operations/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) }),
  markOperationExecuted: (id: string, baseUrl?: string) => call<Record<string, unknown>>(`/v1/operations/${id}/executed`, { method: 'POST', body: JSON.stringify({ baseUrl }) }),
  // Phase 16 — Real Dokploy API Execution
  dokployStatus: () => call<{ configured: boolean; connection: { ok: boolean; error?: string }; lastSyncedAt: string | null; apiTargetCount: number }>('/v1/dokploy/status'),
  syncDokploy: () => call<{ synced: number; lastSyncedAt: string; note?: string }>('/v1/dokploy/sync', { method: 'POST' }),
  retryOperation: (id: string) => call<Record<string, unknown>>(`/v1/operations/${id}/retry`, { method: 'POST' }),
  rollbackOperation: (id: string) => call<Record<string, unknown>>(`/v1/operations/${id}/rollback`, { method: 'POST' }),
  // Phase 17 — Dokploy calibration
  runDokployDiagnostics: () => call<{ probed: number; supported: string[]; unsupported: string[]; diagnostics: Array<Record<string, unknown>> }>('/v1/dokploy/diagnostics', { method: 'POST' }),
  dokployDiagnostics: () => call<Array<Record<string, unknown>>>('/v1/dokploy/diagnostics'),
  dokployMapping: () => call<{ mapping: Array<{ serviceId: string; status: string; appName: string | null; domain: string | null; lastKnownStatus: string | null }>; syncedTargets: number; mappedCount: number }>('/v1/dokploy/mapping'),
  // Phase 18 — Realtime Voice Operator
  voiceContext: (page: string) => call<Record<string, unknown>>(`/v1/voice/context?page=${encodeURIComponent(page)}`),
  startVoiceSession: (currentPage: string) => call<{ voiceSessionId: string }>('/v1/voice/session', { method: 'POST', body: JSON.stringify({ currentPage }) }),
  voiceMessage: (sessionId: string, text: string, currentPage: string) => call<{ proposal: Record<string, unknown>; toolCall: Record<string, unknown>; permissionId: string | null; reply: string; readData: unknown; safeMode: boolean }>('/v1/voice/message', { method: 'POST', body: JSON.stringify({ sessionId, text, currentPage }) }),
  confirmVoiceTool: (id: string) => call<{ executed: boolean; resultSummary: string; linkedTaskId: string | null; linkedOperationPlanId: string | null }>(`/v1/voice/tool/${id}/confirm`, { method: 'POST' }),
  decideVoicePermission: (id: string, action: string) => call<{ status: string; operationPlanId: string | null; message?: string }>(`/v1/voice/permission/${id}/decision`, { method: 'POST', body: JSON.stringify({ action }) }),
  voiceSessions: () => call<unknown[]>('/v1/voice/sessions'),
  voiceSession: (id: string) => call<{ session: Record<string, unknown>; messages: unknown[]; toolCalls: unknown[]; permissions: unknown[] }>(`/v1/voice/sessions/${id}`),
  voiceMemories: () => call<unknown[]>('/v1/voice/memories'),
  voiceToolCalls: () => call<unknown[]>('/v1/voice/tool-calls'),
  voiceRealtimeToken: () => call<{ ok: boolean; model?: string; clientSecret?: string; error?: string }>('/v1/voice/realtime-token', { method: 'POST' }),
};
