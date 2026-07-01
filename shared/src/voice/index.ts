/**
 * Phase 18 — Voice tool-mediation router (pure, deterministic, testable).
 *
 * The voice operator NEVER mutates state directly. Every utterance is routed
 * here into a `ToolProposal` carrying the tool, category, risk, and whether it
 * needs confirmation/approval. The gateway then enforces RBAC, safe mode, and
 * approvals before any real action. The guardrails below are encoded both in the
 * router (deterministic) and surfaced in the system prompt.
 */
import { PROTECTED_CORE_SERVICES, isProtectedCore } from '../operations/index.js';
import { SERVICE_IDS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import type { VoiceMemory, VoiceLearningEvent } from '../schemas/voice.js';

export const VOICE_GUARDRAILS: string[] = [
  'Do not route non-Dokploy tasks into Dokploy operation plans.',
  'Analyze-history runs the learning pipeline, never asks for a Dokploy target.',
  'Security checks run the security pipeline, never ask for a Dokploy target.',
  'Research tasks run the intelligence pipeline, never ask for a Dokploy target.',
  'Only infrastructure/deploy/repair/restart/health-check service operations use operation plans.',
  'Overview is the main control surface.',
  'No fake data, no fake success, no simulation.',
  'No protected-core auto execution — owner approval + visible UI confirmation required.',
  'Always show the next action.',
  'Always explain waiting states.',
];

export type ToolCategory = 'read' | 'low_mutation' | 'gated_mutation' | 'blocked';
export type VoiceRisk = 'low' | 'medium' | 'high' | 'critical';

export interface VoiceContextLite {
  role: string;
  safeMode: boolean;
  currentPage?: string;
}

export interface ToolProposal {
  toolName: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  riskLevel: VoiceRisk;
  requiresApproval: boolean;
  ownerOnly: boolean;
  blocked: boolean;
  blockedReason: string;
  confirm: 'none' | 'light' | 'approval';
  explanation: string;
  guardrailNote: string;
}

/** Short aliases → canonical service ids (for spoken targets). */
const SERVICE_ALIASES: Record<string, string> = {
  gateway: 'gateway-api', api: 'gateway-api', dashboard: 'dashboard-web', orchestrator: 'orchestrator-agent',
  architect: 'architect-agent', builder: 'builder-agent', devops: 'devops-agent', reviewer: 'reviewer-agent',
  qa: 'qa-agent', registry: 'service-registry', memory: 'memory-agent', documentation: 'documentation-service',
  docs: 'documentation-service', events: 'event-bus-service', 'event bus': 'event-bus-service', assets: 'file-asset-service',
  files: 'file-asset-service', monitor: 'monitor-agent', reports: 'report-agent', research: 'internet-research-service',
  browser: 'browser-testing-agent', 'browser testing': 'browser-testing-agent', voice: 'voice-operator-agent',
};

const ALL_SERVICE_IDS = Object.values(SERVICE_IDS) as string[];

/** Detect a target service id mentioned in the utterance, if any. */
export function detectService(text: string): string | null {
  const t = text.toLowerCase();
  for (const id of ALL_SERVICE_IDS) if (t.includes(id)) return id;
  for (const [alias, id] of Object.entries(SERVICE_ALIASES)) if (new RegExp(`\\b${alias}\\b`).test(t)) return id;
  return null;
}

function readTool(toolName: string, explanation: string, args: Record<string, unknown> = {}): ToolProposal {
  return { toolName, category: 'read', args, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: false, blockedReason: '', confirm: 'none', explanation, guardrailNote: '' };
}

/**
 * Route an utterance to a single, safe tool proposal. Deterministic — the same
 * text + context always yields the same proposal. Never executes anything.
 */
export function routeUtterance(text: string, ctx: VoiceContextLite): ToolProposal {
  const t = text.trim().toLowerCase();
  const svc = detectService(text);

  // --- Read / explain ---
  if (/(what.*happening|what's going on|current status|^status\b|explain (this|the)? ?page|where am i|summari[sz]e)/.test(t)) {
    return readTool('explain_current_page', 'I will read the current overview context and explain what is happening, including any active operation and its waiting state.');
  }
  if (/(next (best )?action|what should i do|what.*next)/.test(t)) {
    return readTool('read_status', 'I will read the live system state and tell you the single next best action.');
  }
  if (/(pending )?approvals?|what.*approve/.test(t)) {
    return readTool('list_pending_approvals', 'I will list the approvals currently waiting for a decision.');
  }
  if (/(show|open) (the )?report/.test(t)) return readTool('open_report', 'I will open the latest intelligence report.');
  if (/(show|list) evidence|what proof/.test(t)) return readTool('show_evidence', 'I will show the most recent evidence records.');

  // --- Mutation verbs on a service: restart/redeploy/deploy ---
  if (/\b(restart|redeploy|deploy|reload)\b/.test(t)) {
    const target = svc ?? 'the target service';
    if (svc && isProtectedCore(svc)) {
      return {
        toolName: 'protected_core_update', category: 'blocked', args: { targetService: svc, operationType: 'existing_app_restart' },
        riskLevel: 'critical', requiresApproval: true, ownerOnly: true, blocked: true,
        blockedReason: `${svc} is a protected core service`,
        confirm: 'approval',
        explanation: `${svc} is a protected core service, so this is a CRITICAL operation. I cannot auto-execute it by voice. It needs explicit OWNER approval and a visible UI confirmation, with a snapshot and rollback plan. Would you like me to run a safe health check on ${svc} instead?`,
        guardrailNote: 'Guardrail #8: no protected-core auto execution.',
      };
    }
    return {
      toolName: 'create_operation_plan', category: 'gated_mutation', args: { operationType: /deploy|redeploy/.test(t) ? 'existing_app_update' : /restart|reload/.test(t) ? 'existing_app_restart' : 'existing_app_repair', targetService: svc ?? '' },
      riskLevel: 'high', requiresApproval: true, ownerOnly: false, blocked: ctx.safeMode,
      blockedReason: ctx.safeMode ? 'safe mode is active' : '',
      confirm: 'approval',
      explanation: `I can plan a ${/deploy/.test(t) ? 'deploy' : 'restart'} of the non-core service ${target}. Risk: high. This needs explicit approval (a visible button), a snapshot, and verification afterward${ctx.safeMode ? ' — but safe mode is currently ON, so execution is blocked' : ''}.`,
      guardrailNote: 'Guardrail #5: service operations use operation plans.',
    };
  }

  // --- Env / policy / scoring / delete → blocked or approval-required ---
  if (/(env|environment) (var|variable|update|change)/.test(t)) {
    return { toolName: 'env_update', category: 'blocked', args: { targetService: svc ?? '' }, riskLevel: 'high', requiresApproval: true, ownerOnly: isProtectedCore(svc), blocked: true, blockedReason: 'env changes require approval (and owner for core)', confirm: 'approval', explanation: 'Environment-variable changes are high risk and require explicit approval through the operation flow. I will never paste secrets into this chat.', guardrailNote: 'Secrets are never handled by voice.' };
  }
  if (/\b(delete|destroy|remove .* permanently|wipe|drop)\b/.test(t)) {
    return { toolName: 'delete', category: 'blocked', args: {}, riskLevel: 'critical', requiresApproval: true, ownerOnly: true, blocked: true, blockedReason: 'destructive/delete operations are not implemented', confirm: 'approval', explanation: 'Destructive and delete operations are intentionally not implemented anywhere in this system. I cannot do that.', guardrailNote: 'No destructive operations.' };
  }
  if (/(policy|scoring) (change|update|profile)/.test(t)) {
    return { toolName: /policy/.test(t) ? 'policy_change' : 'scoring_change', category: 'blocked', args: {}, riskLevel: 'critical', requiresApproval: true, ownerOnly: true, blocked: true, blockedReason: 'governance change requires owner approval + audit', confirm: 'approval', explanation: 'Policy and scoring changes are governance actions: owner approval, versioning and audit. Please use the Governance pages to review and approve.', guardrailNote: 'Governance stays approval-gated.' };
  }

  // --- Health check (read-only verification; allowed even on core) ---
  if (/\b(health|healthy|reachable|is .* up|check .*(service|gateway|api|agent))\b/.test(t) || (/check/.test(t) && svc)) {
    return {
      toolName: 'run_health_check', category: 'low_mutation', args: { operationType: 'health_check_only', targetService: svc ?? '' },
      riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: false, blockedReason: '', confirm: 'light',
      explanation: `I will run a read-only health check${svc ? ` on ${svc}` : ''}: no mutation, just a real /health + registry verification, with evidence stored. Confirm to proceed.`,
      guardrailNote: 'Health checks are read-only (low risk), even on core services.',
    };
  }

  // --- Pipelines (NOT Dokploy) — the anti-mistake guardrails ---
  if (/(analy[sz]e|analysis).*(history|system)|learn.*(from )?history|recommend improvements|operational learning/.test(t)) {
    return { toolName: 'run_learning_analysis', category: 'low_mutation', args: { goal: 'Analyze system history and recommend improvements' }, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: ctx.safeMode, blockedReason: ctx.safeMode ? 'safe mode is active' : '', confirm: 'light', explanation: 'I will run the learning pipeline over the real system history (reliability, patterns, recommendations) — this is analysis, not an infrastructure operation. Results appear under Learning.', guardrailNote: 'Guardrail #2: analyze-history → learning pipeline, never Dokploy.' };
  }
  if (/(security check|harden|security audit|production security)/.test(t)) {
    return { toolName: 'run_security_check', category: 'low_mutation', args: {}, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: false, confirm: 'light', blockedReason: '', explanation: 'I will run the production security check (env, secrets, tokens, session, safe-mode). This runs the security pipeline. Results appear under Security.', guardrailNote: 'Guardrail #3: security → security pipeline, never Dokploy.' };
  }
  if (/(research|best practices?|investigate|state of the art)/.test(t)) {
    return { toolName: 'run_research_plan', category: 'low_mutation', args: { goal: text.trim() }, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: ctx.safeMode, blockedReason: ctx.safeMode ? 'safe mode is active' : '', confirm: 'light', explanation: 'I will run the research → plan → review → QA → report pipeline. Results appear under Research and Reports.', guardrailNote: 'Guardrail #4: research → intelligence pipeline, never Dokploy.' };
  }
  if (/(sync).*(dokploy|target)|dokploy.*sync/.test(t)) {
    return { toolName: 'sync_dokploy_targets', category: 'low_mutation', args: {}, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: false, confirm: 'light', blockedReason: '', explanation: 'I will sync the real Dokploy projects/apps into targets (read-only discovery, no mutation).', guardrailNote: '' };
  }
  if (/(dokploy )?diagnostic|probe.*dokploy|discover.*(endpoint|api)/.test(t)) {
    return { toolName: 'run_dokploy_diagnostics', category: 'low_mutation', args: {}, riskLevel: 'low', requiresApproval: false, ownerOnly: false, blocked: false, confirm: 'light', blockedReason: '', explanation: 'I will run read-only Dokploy API diagnostics to discover real endpoint shapes (no mutation, secrets redacted).', guardrailNote: '' };
  }

  // --- Fallback: explain + offer real options ---
  return readTool('explain_current_page', 'I can explain the current page, run a read-only health check, analyze system history, run a security check, research a topic, or sync Dokploy targets. What would you like? (Overview stays the main control surface, and I always ask before any change.)');
}

/* -------------------- memory + learning (deterministic helpers) -------------------- */

export function buildVoiceMemory(userId: string, kind: VoiceMemory['kind'], content: string, sourceSessionId: string | null): VoiceMemory {
  return { memoryId: genId('vmem'), userId, kind, content, sourceSessionId, createdAt: nowIso() };
}

/** Derive a session summary + lessons + candidate memories from what happened. */
export function deriveVoiceLearning(args: { sessionId: string; userId: string; messages: Array<{ direction: string; text: string }>; toolCalls: Array<{ toolName: string; status: string; blockedReason?: string }>; }): { event: VoiceLearningEvent; memories: VoiceMemory[] } {
  const executed = args.toolCalls.filter((c) => c.status === 'executed');
  const blocked = args.toolCalls.filter((c) => c.status === 'blocked' || c.status === 'rejected');
  const lessons: string[] = [];
  const memories: VoiceMemory[] = [];
  if (blocked.some((c) => /protected_core|core/.test(c.toolName))) {
    lessons.push('Protected core services require explicit owner approval and visible UI confirmation.');
    memories.push(buildVoiceMemory(args.userId, 'mistake_avoidance', 'Never auto-execute protected-core operations by voice; require owner + UI.', args.sessionId));
  }
  if (executed.some((c) => c.toolName === 'run_learning_analysis')) memories.push(buildVoiceMemory(args.userId, 'mapping', 'Analyze-history routes to the learning pipeline (not Dokploy).', args.sessionId));
  const summary = `Voice session: ${executed.length} executed, ${blocked.length} blocked/rejected, ${args.messages.length} messages.`;
  const event: VoiceLearningEvent = { learningEventId: genId('vlearn'), sessionId: args.sessionId, userId: args.userId, summary, lessons, linkedTaskIds: [], linkedEvidenceIds: [], createdAt: nowIso() };
  return { event, memories };
}
