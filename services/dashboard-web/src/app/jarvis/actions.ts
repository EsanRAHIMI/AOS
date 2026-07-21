'use server';
/**
 * Phase AF.1 — server action for the daily command briefing. Single source
 * of truth consumed by BOTH the homepage Presence Bar/Focus Row (server
 * component, calls this directly) and the persistent Jarvis shell (client
 * component, calls this to refresh). One mapped shape, one real endpoint
 * (`GET /v1/jarvis/briefing`, Phase AE/AE.1) — no duplicated fetch/mapping
 * logic between the two call sites.
 */
import { gateway } from '@/lib/gateway';

export interface JarvisMemoryFactView { kind: string; content: string; importance: number; createdAt: string }
export interface JarvisPrioritizedItemView { label: string; detail: string; type: 'task' | 'project' | 'action'; weight: number }

export interface JarvisBriefingView {
  briefingId: string;
  headline: string;
  narrative: string;
  primaryPriority: string;
  activeBlockers: string[];
  systemWarnings: string[];
  recommendedNextActions: string[];
  suggestedFollowUps: string[];
  memoryFactsUsed: JarvisMemoryFactView[];
  prioritizedItems: JarvisPrioritizedItemView[];
  confidence: number;
  dataFreshness: string;
  language: string;
}

/** Real endpoint, real mapping — never a hardcoded/placeholder briefing.
 *  Returns null (never a fake object) when the kernel is unreachable or the
 *  actor has no scoped context yet; callers must render an honest empty
 *  state, not invented content. */
export async function getBriefingAction(): Promise<JarvisBriefingView | null> {
  const r = await gateway.briefing();
  if (!r) return null;
  return {
    briefingId: r.briefingId,
    headline: r.headline,
    narrative: r.narrative,
    primaryPriority: r.primaryPriority,
    activeBlockers: r.activeBlockers,
    systemWarnings: r.systemWarnings,
    recommendedNextActions: r.recommendedNextActions,
    suggestedFollowUps: r.suggestedFollowUps,
    memoryFactsUsed: r.memoryFactsUsed,
    prioritizedItems: r.prioritizedItems,
    confidence: r.confidence,
    dataFreshness: r.dataFreshness,
    language: r.language,
  };
}

/* ============================ K2 Persistent Jarvis (D-177) ================ */

export interface JarvisSessionView { sessionId: string; title: string; turnCount: number; lastTurnAt: string | null; totalCostUsd: number }
export interface JarvisTurnView { turnId: string; userText: string; replyText: string; status: string; reasoningMode: string; provider: string; costUsd: number; pendingApprovalId: string | null; runId: string | null; createdAt: string }
export interface JarvisTurnResult { turnId: string; runId: string | null; status: string; replyText: string; pendingApprovalId: string | null; reasoningMode: string }

export async function listSessionsAction(): Promise<JarvisSessionView[]> {
  return (await gateway.jarvisSessions()) ?? [];
}

export async function createSessionAction(title?: string): Promise<string | null> {
  const r = await gateway.createJarvisSession(title);
  return r?.sessionId ?? null;
}

export async function getSessionAction(sessionId: string): Promise<{ session: JarvisSessionView | null; turns: JarvisTurnView[] }> {
  const r = await gateway.jarvisSession(sessionId);
  if (!r) return { session: null, turns: [] };
  return { session: r.session as unknown as JarvisSessionView, turns: (r.turns as unknown as JarvisTurnView[]) ?? [] };
}

export async function sendTurnAction(
  sessionId: string,
  text: string,
  transport: 'text' | 'voice' = 'text',
): Promise<JarvisTurnResult | null> {
  return gateway.jarvisTurn(sessionId, text, transport);
}

export async function decideApprovalAction(approvalId: string, runId: string, action: 'approve' | 'reject', reason?: string): Promise<{ status: string; replyText: string; pendingApprovalId: string | null } | null> {
  return gateway.jarvisApprovalDecision(approvalId, runId, action, reason);
}

export async function intelligenceStatusAction() {
  return gateway.jarvisIntelligenceStatus();
}

export async function listMemoriesAction() {
  return (await gateway.jarvisMemories()) ?? [];
}

export async function correctMemoryAction(id: string, newContent: string) {
  return gateway.jarvisMemoryCorrect(id, newContent);
}
export async function pinMemoryAction(id: string, pinned: boolean) {
  return gateway.jarvisMemoryPin(id, pinned);
}
export async function deleteMemoryAction(id: string) {
  return gateway.jarvisMemoryDelete(id);
}
export async function listToolsAction() {
  return gateway.jarvisTools();
}

/* ===================== K2 Product Activation (D-178) ====================== */

export interface OnboardingQuestion { id: string; fa: string; en: string; kind: string }

export async function onboardingQuestionsAction(): Promise<OnboardingQuestion[]> {
  const r = await gateway.jarvisOnboardingQuestions();
  return (r?.questions as unknown as OnboardingQuestion[]) ?? [];
}

export async function submitOnboardingAction(answers: Record<string, string>): Promise<{ created: string[]; visionId: string | null } | null> {
  return gateway.jarvisOnboarding(answers);
}

export async function personalStateAction() {
  return gateway.jarvisPersonalState();
}

/* ===================== Jarvis live HUD telemetry ========================== */

export type TelemetryTone = 'ok' | 'warn' | 'err' | 'muted';

export interface JarvisTelemetryView {
  mode: { value: string; detail: string; tone: TelemetryTone };
  loop: { value: string; detail: string; tone: TelemetryTone };
  cost: { value: string; detail: string; tone: TelemetryTone };
  trust: { value: string; detail: string; tone: TelemetryTone };
  fetchedAt: string;
}

/** Real kernel reads for the four HUD corner panels — never invented numbers. */
export async function jarvisTelemetryAction(sessionId?: string | null): Promise<JarvisTelemetryView> {
  const [intel, inbox, cycles, sessions, approvals] = await Promise.all([
    gateway.jarvisIntelligenceStatus(),
    gateway.loopInbox(),
    gateway.loopCycles(5),
    gateway.jarvisSessions(),
    gateway.approvals(),
  ]);

  const modeValue = !intel
    ? '—'
    : intel.degraded
      ? 'DEGRADED'
      : intel.isLocal
        ? 'LOCAL'
        : (intel.provider || 'CLOUD').toUpperCase();
  const modeDetail = !intel
    ? 'unreachable'
    : intel.degraded
      ? (intel.degradedDetail || 'model offline')
      : (intel.models?.standard ?? intel.provider);
  const modeTone: TelemetryTone = !intel ? 'muted' : intel.degraded ? 'warn' : intel.safeMode ? 'warn' : 'ok';

  const events = inbox?.events ?? [];
  const openCount = events.filter((e) => {
    const s = String((e as { status?: string }).status ?? 'pending');
    return s === 'pending' || s === 'processing';
  }).length;
  const latest = (cycles?.cycles?.[0] ?? null) as { status?: string; triggerSummary?: string } | null;
  const p50 = inbox?.latency?.p50;
  const loopValue = latest?.status ? String(latest.status).replace(/_/g, ' ') : (openCount > 0 ? `${openCount} open` : 'idle');
  const loopDetail = p50 != null ? `p50 ${Math.round(p50)}ms · ${openCount} inbox` : (openCount ? `${openCount} inbox` : 'no cycles yet');
  const loopTone: TelemetryTone = !inbox && !cycles ? 'muted' : String(latest?.status) === 'awaiting_approval' ? 'warn' : openCount > 5 ? 'warn' : 'ok';

  const session = sessionId
    ? (sessions ?? []).find((s) => s.sessionId === sessionId) ?? (sessions ?? [])[0]
    : (sessions ?? [])[0];
  const usd = session?.totalCostUsd ?? 0;
  const turns = session?.turnCount ?? 0;
  const costValue = session ? `$${usd.toFixed(usd >= 1 ? 2 : 3)}` : '—';
  const costDetail = session ? `${turns} turn${turns === 1 ? '' : 's'}` : 'no session';
  const costTone: TelemetryTone = session ? 'ok' : 'muted';

  const pending = Array.isArray(approvals) ? approvals.length : 0;
  const safe = Boolean(intel?.safeMode);
  const trustValue = safe ? 'SAFE ON' : pending > 0 ? `${pending} HOLD` : 'CLEAR';
  const trustDetail = safe ? 'execution blocked' : pending > 0 ? 'awaiting approval' : 'governed';
  const trustTone: TelemetryTone = safe || pending > 0 ? 'warn' : intel ? 'ok' : 'muted';

  return {
    mode: { value: modeValue, detail: modeDetail, tone: modeTone },
    loop: { value: loopValue, detail: loopDetail, tone: loopTone },
    cost: { value: costValue, detail: costDetail, tone: costTone },
    trust: { value: trustValue, detail: trustDetail, tone: trustTone },
    fetchedAt: new Date().toISOString(),
  };
}
