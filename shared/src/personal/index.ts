/**
 * Phase AB — Personal Reality Baseline & Jarvis Intelligence Layer (core).
 *
 * Deterministic, scoped personal intelligence for the authorized user (Esan
 * first). Everything here is pure and testable; the gateway feeds it REAL
 * scoped records and persists the results. Hard rules:
 *  - every record carries scope/source/confidence/freshness
 *  - facts, preferences, goals, inferences, recommendations, decisions and
 *    actions are SEPARATED by recordKind — inferences never become facts
 *  - missing sources are reported not_configured, never simulated
 *  - resume analysis never invents credentials
 *  - no secrets, no cross-user data, no fake market claims
 *
 * Future extraction path: these engines are designed to lift into dedicated
 * agents (daily-briefing-agent, personal-strategy-agent, opportunity-agent,
 * brand-resume-agent, …) via the workspace runtime once volume justifies it —
 * the schemas and function signatures are already service-shaped.
 */
import { z } from 'zod';
import { IsoDate } from '../schemas/common.js';
import { RequiredScopeSchema } from '../schemas/scope.js';
import { genId, nowIso } from '../utils/index.js';

/* ================================ schemas =============================== */

export const RecordKind = z.enum(['fact', 'preference', 'goal', 'inference', 'recommendation', 'decision', 'action']);
export type RecordKind = z.infer<typeof RecordKind>;

/** Source + trust metadata every personal record carries. */
const Sourced = z.object({
  source: z.string().default('user'),           // user | ingestion:<kind> | aos_history | connector:<type> | model_inference
  confidence: z.number().min(0).max(1).default(1),
  freshness: IsoDate,                            // when this was last confirmed
  recordKind: RecordKind.default('fact'),
});

export const PersonalRealityProfileSchema = RequiredScopeSchema.merge(Sourced).extend({
  profileId: z.string(),
  displayName: z.string().default(''),
  headline: z.string().default(''),
  summary: z.string().default(''),
  location: z.string().default(''),
  focusAreas: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  currentPosition: z.string().default(''),
  incomeDirection: z.string().default(''),
  scheduleDirection: z.string().default(''),
  learningDirection: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PersonalRealityProfile = z.infer<typeof PersonalRealityProfileSchema>;

const NamedScopedBase = RequiredScopeSchema.merge(Sourced).extend({
  title: z.string(),
  description: z.string().default(''),
  status: z.enum(['active', 'paused', 'done', 'dropped']).default('active'),
  tags: z.array(z.string()).default([]),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

export const PersonalAssetSchema = NamedScopedBase.extend({
  assetId: z.string(),
  assetType: z.enum(['skill', 'software', 'content', 'audience', 'infrastructure', 'financial', 'credential', 'other']).default('other'),
});
export type PersonalAsset = z.infer<typeof PersonalAssetSchema>;

export const PersonalProjectSchema = NamedScopedBase.extend({
  projectId: z.string(),
  incomePotential: z.enum(['none', 'low', 'medium', 'high', 'unknown']).default('unknown'),
  linkedGoalIds: z.array(z.string()).default([]),
});
export type PersonalProject = z.infer<typeof PersonalProjectSchema>;

export const PersonalSystemSchema = NamedScopedBase.extend({
  systemId: z.string(),
  systemType: z.enum(['software', 'automation', 'process', 'habit', 'aos_service', 'other']).default('other'),
});
export type PersonalSystem = z.infer<typeof PersonalSystemSchema>;

export const PersonalRiskSchema = NamedScopedBase.extend({
  riskId: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  mitigation: z.string().default(''),
});
export type PersonalRisk = z.infer<typeof PersonalRiskSchema>;

export const PersonalOpportunitySchema = RequiredScopeSchema.merge(Sourced).extend({
  opportunityId: z.string(),
  title: z.string(),
  category: z.enum(['income', 'career', 'product_saas', 'business', 'technology', 'brand_resume', 'aos_capability']),
  reason: z.string(),
  linkedGoalIds: z.array(z.string()).default([]),
  linkedAssetIds: z.array(z.string()).default([]),
  impactScore: z.number().min(0).max(10),
  effortScore: z.number().min(0).max(10),
  riskScore: z.number().min(0).max(10),
  recommendedNextAction: z.string().default(''),
  status: z.enum(['proposed', 'accepted', 'rejected', 'in_progress', 'done', 'expired']).default('proposed'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PersonalOpportunity = z.infer<typeof PersonalOpportunitySchema>;

export const PersonalIncomeStreamSchema = NamedScopedBase.extend({
  incomeStreamId: z.string(),
  streamType: z.enum(['salary', 'freelance', 'product', 'saas', 'content', 'investment', 'idea', 'other']).default('idea'),
  monthlyEstimate: z.number().nullable().default(null), // user-provided only; never invented
});
export type PersonalIncomeStream = z.infer<typeof PersonalIncomeStreamSchema>;

export const PersonalLearningTrackSchema = NamedScopedBase.extend({
  learningTrackId: z.string(),
  targetSkill: z.string().default(''),
  linkedGoalIds: z.array(z.string()).default([]),
});
export type PersonalLearningTrack = z.infer<typeof PersonalLearningTrackSchema>;

export const PersonalCareerRecordSchema = RequiredScopeSchema.merge(Sourced).extend({
  careerRecordId: z.string(),
  kind: z.enum(['experience', 'education', 'achievement', 'certification']),
  title: z.string(),
  organization: z.string().default(''),
  period: z.string().default(''),
  details: z.string().default(''),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PersonalCareerRecord = z.infer<typeof PersonalCareerRecordSchema>;

export const ResumeProfileSchema = RequiredScopeSchema.merge(Sourced).extend({
  resumeProfileId: z.string(),
  rawText: z.string().default(''),
  skills: z.array(z.string()).default([]),
  positioning: z.string().default(''),
  // STRICT separation — suggestions/inferences never merge into claims.
  verifiedFacts: z.array(z.string()).default([]),
  userClaims: z.array(z.string()).default([]),
  modelInferences: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const TechnologyWatchItemSchema = RequiredScopeSchema.merge(Sourced).extend({
  watchItemId: z.string(),
  topic: z.string(),
  relevance: z.string().default(''),
  status: z.enum(['watching', 'evaluating', 'adopted', 'dismissed']).default('watching'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type TechnologyWatchItem = z.infer<typeof TechnologyWatchItemSchema>;

export const NextBestActionSchema = RequiredScopeSchema.merge(Sourced).extend({
  actionId: z.string(),
  title: z.string(),
  reason: z.string(),
  category: z.enum(['income', 'growth', 'system', 'risk', 'approval', 'data', 'aos_build']),
  priorityScore: z.number(),
  linkedGoalIds: z.array(z.string()).default([]),
  linkedOpportunityIds: z.array(z.string()).default([]),
  executable: z.boolean().default(false),
  executeHint: z.string().default(''),
  status: z.enum(['proposed', 'accepted', 'rejected', 'completed', 'expired']).default('proposed'),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type NextBestAction = z.infer<typeof NextBestActionSchema>;

export const PersonalBriefingRunSchema = RequiredScopeSchema.merge(Sourced).extend({
  briefingRunId: z.string(),
  date: z.string(),
  topPriorities: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  incomeAction: z.string().default(''),
  growthAction: z.string().default(''),
  aosAction: z.string().default(''),
  pendingApprovals: z.number().default(0),
  missingData: z.array(z.string()).default([]),
  sourcesUsed: z.array(z.string()).default([]),
  sourcesNotConfigured: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type PersonalBriefingRun = z.infer<typeof PersonalBriefingRunSchema>;

export const StrategyReviewRunSchema = RequiredScopeSchema.merge(Sourced).extend({
  strategyRunId: z.string(),
  weekOf: z.string(),
  goalsReviewed: z.number().default(0),
  completedActions: z.number().default(0),
  missedActions: z.number().default(0),
  newOpportunities: z.number().default(0),
  weeklyPlan: z.array(z.string()).default([]),
  aosShouldBuild: z.array(z.string()).default([]),
  esanShouldDo: z.array(z.string()).default([]),
  needsApproval: z.array(z.string()).default([]),
  createdAt: IsoDate,
});
export type StrategyReviewRun = z.infer<typeof StrategyReviewRunSchema>;

/* ============= Phase AC+ — Command Universe domain schemas ============== */

/** Health/body state — user-reported or (later) connector-sourced. One record
 *  per metric report; the body map renders the latest per metric. Never fake. */
export const PersonalHealthStateSchema = RequiredScopeSchema.merge(Sourced).extend({
  healthStateId: z.string(),
  metric: z.enum(['wellbeing', 'energy', 'sleep', 'stress', 'weight', 'activity', 'nutrition', 'symptom', 'habit']),
  /** 0–10 for scaled metrics; free value (e.g. kg, hours) goes in `value`. */
  level: z.number().min(0).max(10).nullable().default(null),
  value: z.string().default(''),
  note: z.string().default(''),
  concern: z.boolean().default(false),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PersonalHealthState = z.infer<typeof PersonalHealthStateSchema>;

/** Family / home / relationships / household — the personal world structure. */
export const PersonalLifeItemSchema = NamedScopedBase.extend({
  lifeItemId: z.string(),
  domain: z.enum(['family', 'home', 'relationship', 'household', 'personal']),
  itemType: z.enum(['responsibility', 'concern', 'event', 'task', 'note']).default('responsibility'),
  dueDate: z.string().nullable().default(null),
  importance: z.enum(['low', 'normal', 'high']).default('normal'),
});
export type PersonalLifeItem = z.infer<typeof PersonalLifeItemSchema>;

/** Finance structure: user-entered amounts only — never invented. */
export const PersonalFinanceItemSchema = NamedScopedBase.extend({
  financeItemId: z.string(),
  itemType: z.enum(['income', 'expense', 'bill', 'installment', 'obligation', 'investment', 'purchase', 'sale']),
  amount: z.number().nullable().default(null),
  currency: z.string().default(''),
  cadence: z.enum(['once', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  dueDate: z.string().nullable().default(null),
});
export type PersonalFinanceItem = z.infer<typeof PersonalFinanceItemSchema>;

/* ============================== ingestion =============================== */

export const INGESTION_KINDS = ['profile', 'resume', 'project', 'system', 'asset', 'goal', 'income_idea', 'risk', 'learning_track', 'career_record', 'tech_watch', 'health_state', 'life_item', 'finance_item'] as const;
export type IngestionKind = (typeof INGESTION_KINDS)[number];

export interface IngestionResult {
  source: string;
  kind: IngestionKind;
  recordsCreated: number;
  recordsUpdated: number;
  confidence: number;
  missingData: string[];
  nextSuggestedConnector: string;
}

/** Which connector would most improve this data kind next (honest guidance). */
export function nextConnectorFor(kind: IngestionKind): string {
  switch (kind) {
    case 'profile': case 'resume': case 'career_record': return 'linkedin/drive (not_configured — consent grant + connector phase required)';
    case 'project': case 'system': return 'github (not_configured — set GITHUB_TOKEN + consent)';
    case 'goal': case 'learning_track': return 'calendar/tasks (not_configured — consent grant required)';
    case 'income_idea': return 'finance (not_configured — finance connectors are a later phase, approval-gated)';
    case 'risk': case 'asset': case 'tech_watch': return 'none — manual input is the primary source for now';
    case 'health_state': return 'health wearable/app (not_configured — a later consent-gated connector phase)';
    case 'life_item': return 'calendar (not_configured — consent grant required)';
    case 'finance_item': return 'bank/finance (not_configured — finance connectors are a later, approval-gated phase)';
  }
}

/* ===================== personal intelligence graph ====================== */

export interface PersonalGraphInput {
  profile: PersonalRealityProfile | null;
  goals: Array<{ goalId: string; title: string; status: string; priority: string }>;
  projects: PersonalProject[];
  assets: PersonalAsset[];
  systems: PersonalSystem[];
  risks: PersonalRisk[];
  opportunities: PersonalOpportunity[];
  incomeStreams: PersonalIncomeStream[];
  pendingApprovals: number;
  activeConsents: string[];
}

export interface PersonalGraph {
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ from: string; to: string; rel: string }>;
  missingData: string[];
  dataFreshness: string;
}

export function buildPersonalGraph(input: PersonalGraphInput): PersonalGraph {
  const nodes: PersonalGraph['nodes'] = [];
  const edges: PersonalGraph['edges'] = [];
  const userNode = 'user';
  nodes.push({ id: userNode, type: 'user', label: input.profile?.displayName || 'User' });
  for (const g of input.goals) { nodes.push({ id: g.goalId, type: 'goal', label: g.title }); edges.push({ from: userNode, to: g.goalId, rel: 'pursues' }); }
  for (const p of input.projects) {
    nodes.push({ id: p.projectId, type: 'project', label: p.title });
    edges.push({ from: userNode, to: p.projectId, rel: 'builds' });
    for (const gid of p.linkedGoalIds) edges.push({ from: p.projectId, to: gid, rel: 'serves_goal' });
  }
  for (const a of input.assets) { nodes.push({ id: a.assetId, type: 'asset', label: a.title }); edges.push({ from: userNode, to: a.assetId, rel: 'owns' }); }
  for (const s of input.systems) { nodes.push({ id: s.systemId, type: 'system', label: s.title }); edges.push({ from: userNode, to: s.systemId, rel: 'operates' }); }
  for (const r of input.risks) { nodes.push({ id: r.riskId, type: 'risk', label: r.title }); edges.push({ from: r.riskId, to: userNode, rel: 'threatens' }); }
  for (const o of input.opportunities) {
    nodes.push({ id: o.opportunityId, type: 'opportunity', label: o.title });
    for (const gid of o.linkedGoalIds) edges.push({ from: o.opportunityId, to: gid, rel: 'advances_goal' });
    for (const aid of o.linkedAssetIds) edges.push({ from: o.opportunityId, to: aid, rel: 'leverages_asset' });
  }
  const missingData: string[] = [];
  if (!input.profile) missingData.push('personal profile (role + focus)');
  if (input.goals.length === 0) missingData.push('at least one active goal');
  if (input.projects.length === 0) missingData.push('projects you are working on');
  if (input.assets.length === 0) missingData.push('skills and assets');
  if (input.incomeStreams.length === 0) missingData.push('income streams or ideas');
  if (input.risks.length === 0) missingData.push('known risks or blockers');
  if (!input.activeConsents.includes('calendar')) missingData.push('calendar connector');
  if (!input.activeConsents.includes('email')) missingData.push('email connector');
  const freshest = [input.profile?.freshness, ...input.projects.map((p) => p.freshness)].filter(Boolean).sort().pop();
  return { nodes, edges, missingData, dataFreshness: freshest ?? 'no data yet' };
}

/* ======================= next-best-action engine ======================== */

/** Deterministic priority: urgency (risks/approvals) > goal-linked opportunity
 *  value (impact*2 − effort − risk) > data completeness. Same input ⇒ same
 *  ranking. Every action carries a specific reason — never generic. */
export function scoreNextActions(input: PersonalGraphInput, stamp: { scope: 'user'; tenantId: string | null; userId: string | null; projectId: string | null; caseId: string | null; visibility: 'private'; createdBy: string; updatedBy: string | null }): NextBestAction[] {
  const now = nowIso();
  const actions: NextBestAction[] = [];
  const mk = (title: string, reason: string, category: NextBestAction['category'], priorityScore: number, extra: Partial<NextBestAction> = {}): NextBestAction =>
    NextBestActionSchema.parse({ ...stamp, actionId: genId('nba'), title, reason, category, priorityScore: Math.round(priorityScore * 10) / 10, source: 'aos_engine', confidence: 0.8, freshness: now, recordKind: 'recommendation', createdAt: now, updatedAt: now, ...extra });

  for (const r of input.risks.filter((x) => x.status === 'active')) {
    const sev = { low: 3, medium: 5, high: 8, critical: 10 }[r.severity];
    actions.push(mk(`Mitigate risk: ${r.title}`, `Severity ${r.severity}${r.mitigation ? ` — planned mitigation: ${r.mitigation}` : ' — no mitigation recorded yet'}.`, 'risk', sev + 2));
  }
  if (input.pendingApprovals > 0) {
    actions.push(mk(`Decide ${input.pendingApprovals} pending approval(s)`, 'Approvals block queued work; deciding them unblocks execution immediately.', 'approval', 9));
  }
  for (const o of input.opportunities.filter((x) => x.status === 'proposed' || x.status === 'accepted')) {
    const value = o.impactScore * 2 - o.effortScore - o.riskScore + (o.linkedGoalIds.length > 0 ? 2 : 0);
    actions.push(mk(
      o.recommendedNextAction || `Advance opportunity: ${o.title}`,
      `${o.reason} Impact ${o.impactScore}/10, effort ${o.effortScore}/10, risk ${o.riskScore}/10${o.linkedGoalIds.length ? `, advances ${o.linkedGoalIds.length} goal(s)` : ', not yet linked to a goal'}. Source: ${o.source} (confidence ${o.confidence}).`,
      o.category === 'aos_capability' ? 'aos_build' : 'income',
      value / 2 + 3,
      { linkedGoalIds: o.linkedGoalIds, linkedOpportunityIds: [o.opportunityId] },
    ));
  }
  const missing = buildPersonalGraph(input).missingData;
  if (missing.length > 0) {
    actions.push(mk(`Complete: ${missing[0]}`, `Your profile is stronger once this is filled in.`, 'data', 4 + Math.min(missing.length, 4) * 0.5, { executable: true, executeHint: 'Tell Jarvis in one sentence, or use the intake panel on /me' }));
  }
  const activeGoals = input.goals.filter((g) => g.status === 'active');
  const firstGoal = activeGoals[0];
  if (firstGoal && input.projects.length === 0) {
    actions.push(mk(`Start a project for goal “${firstGoal.title}”`, 'You have active goals but no projects executing them.', 'growth', 6, { linkedGoalIds: [firstGoal.goalId] }));
  }
  return actions.sort((a, b) => b.priorityScore - a.priorityScore);
}

/* ========================= daily briefing engine ======================== */

export interface BriefingSources { calendar: boolean; email: boolean; tasksConnector: boolean }

export function buildDailyBriefingRun(input: PersonalGraphInput, sources: BriefingSources, aosSuggestion: string, stamp: Parameters<typeof scoreNextActions>[1]): PersonalBriefingRun {
  const now = nowIso();
  const ranked = scoreNextActions(input, stamp);
  const graph = buildPersonalGraph(input);
  const incomeAction = ranked.find((a) => a.category === 'income')?.title ?? 'No income opportunity recorded — ingest an income idea or run the opportunity engine.';
  const growthAction = ranked.find((a) => a.category === 'growth')?.title ?? (input.goals[0] ? `Advance goal “${input.goals[0].title}” today.` : 'Record at least one goal — growth actions derive from goals.');
  const notConfigured: string[] = [];
  if (!sources.calendar) notConfigured.push('calendar: not_configured');
  if (!sources.email) notConfigured.push('email: not_configured');
  if (!sources.tasksConnector) notConfigured.push('tasks: limited_to_aos_tasks');
  return PersonalBriefingRunSchema.parse({
    ...stamp, briefingRunId: genId('pbrief'), date: now.slice(0, 10),
    topPriorities: ranked.slice(0, 3).map((a) => a.title),
    risks: input.risks.filter((r) => r.status === 'active').map((r) => `${r.title} (${r.severity})`),
    incomeAction, growthAction,
    aosAction: aosSuggestion,
    pendingApprovals: input.pendingApprovals,
    missingData: graph.missingData,
    sourcesUsed: ['personal_reality_records', 'aos_state'],
    sourcesNotConfigured: notConfigured,
    source: 'aos_engine', confidence: 0.85, freshness: now, recordKind: 'recommendation', createdAt: now,
  });
}

/* ======================== weekly strategy engine ======================== */

export function buildWeeklyStrategyRun(input: PersonalGraphInput & { completedActions: number; missedActions: number; newOpportunities: number }, stamp: Parameters<typeof scoreNextActions>[1]): StrategyReviewRun {
  const now = nowIso();
  const ranked = scoreNextActions(input, stamp);
  const aosShouldBuild = ranked.filter((a) => a.category === 'aos_build').map((a) => a.title);
  if (aosShouldBuild.length === 0) aosShouldBuild.push('No AOS capability gap recorded this week — run the opportunity engine or ingest a system need.');
  return StrategyReviewRunSchema.parse({
    ...stamp, strategyRunId: genId('pstrat'), weekOf: now.slice(0, 10),
    goalsReviewed: input.goals.length,
    completedActions: input.completedActions, missedActions: input.missedActions, newOpportunities: input.newOpportunities,
    weeklyPlan: ranked.slice(0, 5).map((a, i) => `${i + 1}. ${a.title} — ${a.reason.slice(0, 100)}`),
    aosShouldBuild,
    esanShouldDo: ranked.filter((a) => a.category !== 'aos_build').slice(0, 3).map((a) => a.title),
    needsApproval: input.pendingApprovals > 0 ? [`${input.pendingApprovals} pending approval(s) on the Overview`] : [],
    source: 'aos_engine', confidence: 0.8, freshness: now, recordKind: 'recommendation', createdAt: now,
  });
}

/* ========================== opportunity engine ========================== */

export const opportunityValue = (o: Pick<PersonalOpportunity, 'impactScore' | 'effortScore' | 'riskScore' | 'linkedGoalIds'>): number =>
  Math.round((o.impactScore * 2 - o.effortScore - o.riskScore + (o.linkedGoalIds.length > 0 ? 2 : 0)) * 10) / 10;

export function rankOpportunities(list: PersonalOpportunity[]): Array<PersonalOpportunity & { valueScore: number }> {
  return list.map((o) => ({ ...o, valueScore: opportunityValue(o) })).sort((a, b) => b.valueScore - a.valueScore);
}

/* ============================ resume analysis =========================== */

/** Analyze ONLY provided resume/career data. Facts come solely from the
 *  user's records; the engine adds inferences and suggestions in their own
 *  buckets and NEVER invents credentials. */
export function analyzeResume(input: { rawText: string; skills: string[]; careerRecords: PersonalCareerRecord[]; goals: Array<{ title: string }> }): { verifiedFacts: string[]; userClaims: string[]; modelInferences: string[]; suggestions: string[]; positioning: string } {
  const userClaims: string[] = [];
  const verifiedFacts: string[] = [];
  for (const c of input.careerRecords) {
    const line = `${c.kind}: ${c.title}${c.organization ? ` @ ${c.organization}` : ''}${c.period ? ` (${c.period})` : ''}`;
    (c.source.startsWith('connector:') ? verifiedFacts : userClaims).push(line);
  }
  for (const s of input.skills) userClaims.push(`skill: ${s}`);
  const modelInferences: string[] = [];
  if (input.skills.length >= 5) modelInferences.push(`Broad skill surface (${input.skills.length} listed) — positioning should pick 2–3 spearheads instead of listing everything. [inference, confidence 0.6]`);
  if (input.careerRecords.length === 0 && input.rawText.length < 100) modelInferences.push('Not enough career data to infer positioning. [inference from absence]');
  const suggestions: string[] = [];
  if (input.careerRecords.filter((c) => c.kind === 'achievement').length === 0) suggestions.push('Add measurable achievements (numbers, outcomes) — currently none are recorded.');
  if (input.goals[0]) suggestions.push(`Align the headline with your top goal (“${input.goals[0].title}”) so the resume sells the direction you actually want.`);
  if (!input.rawText) suggestions.push('Ingest the full resume text (ingest kind=resume) for deeper analysis.');
  suggestions.push('Verification upgrade: connect GitHub/LinkedIn later to move claims into verified facts (connectors not_configured yet).');
  const positioning = input.careerRecords.length || input.skills.length
    ? `Based only on your provided data: ${input.skills.slice(0, 3).join(', ') || 'core experience'} practitioner${input.goals[0] ? ` heading toward “${input.goals[0].title}”` : ''}.`
    : 'No positioning possible yet — no resume data ingested.';
  return { verifiedFacts, userClaims, modelInferences, suggestions, positioning };
}

/* ================= Phase AC+ — Command Universe contract ================= */

export type ZoneStatus = 'live' | 'setup_needed' | 'not_configured' | 'attention';

export interface ZoneItem { label: string; detail: string; tone: 'ok' | 'warn' | 'err' | 'neutral'; href?: string }

export interface UniverseZone {
  zoneId: 'health' | 'daily' | 'life' | 'finance' | 'ventures' | 'growth' | 'opportunities' | 'systems' | 'presence';
  title: string;
  status: ZoneStatus;
  headline: string;
  items: ZoneItem[];
  /** Exactly how to activate/improve this zone — honest, actionable. */
  setupHint: string;
  jarvisCommand: string;
  href: string;
  metrics: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'err' | 'neutral' }>;
}

export interface UniverseInput {
  graph: PersonalGraphInput;
  healthStates: PersonalHealthState[];
  lifeItems: PersonalLifeItem[];
  financeItems: PersonalFinanceItem[];
  learningTracks: Array<{ title: string; targetSkill: string; status: string }>;
  nextActions: NextBestAction[];
  latestBriefing: PersonalBriefingRun | null;
  kernel: { services: number; openIncidents: number; pendingApprovals: number; safeMode: boolean; activeOperation: string | null; activeRuntimeGoal: string | null; recentEvents: string[] };
  connectors: Array<{ connectorType: string; status: string }>;
}

/** Latest health state per metric (the body map contract). */
export function latestHealthByMetric(states: PersonalHealthState[]): Map<string, PersonalHealthState> {
  const m = new Map<string, PersonalHealthState>();
  for (const s of [...states].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) m.set(s.metric, s);
  return m;
}

/** Monthly-normalized finance aggregation from user-entered amounts only. */
export function aggregateFinance(items: PersonalFinanceItem[]): { monthlyIn: number; monthlyOut: number; net: number; obligations: number; upcoming: PersonalFinanceItem[]; hasAmounts: boolean } {
  const monthly = (i: PersonalFinanceItem): number => {
    if (i.amount === null) return 0;
    const f = { once: 0, weekly: 4.33, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[i.cadence];
    return i.amount * f;
  };
  const inTypes = new Set(['income', 'sale']);
  const outTypes = new Set(['expense', 'bill', 'installment', 'obligation', 'purchase']);
  const active = items.filter((i) => i.status === 'active');
  const monthlyIn = active.filter((i) => inTypes.has(i.itemType)).reduce((s, i) => s + monthly(i), 0);
  const monthlyOut = active.filter((i) => outTypes.has(i.itemType)).reduce((s, i) => s + monthly(i), 0);
  const upcoming = active.filter((i) => i.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 5);
  return {
    monthlyIn: Math.round(monthlyIn * 100) / 100,
    monthlyOut: Math.round(monthlyOut * 100) / 100,
    net: Math.round((monthlyIn - monthlyOut) * 100) / 100,
    obligations: active.filter((i) => ['installment', 'obligation', 'bill'].includes(i.itemType)).length,
    upcoming,
    hasAmounts: active.some((i) => i.amount !== null),
  };
}

/** Build all nine zones. Pure and honest: a zone is 'live' only when real
 *  scoped data backs it; otherwise setup_needed/not_configured with exact
 *  activation guidance. Same input ⇒ same output. */
export function buildUniverseZones(input: UniverseInput): UniverseZone[] {
  const zones: UniverseZone[] = [];
  const g = input.graph;

  // 1 — Health / body
  const hm = latestHealthByMetric(input.healthStates);
  const concerns = input.healthStates.filter((h) => h.concern);
  zones.push({
    zoneId: 'health', title: 'Body & Health', href: '/me/reality',
    status: hm.size === 0 ? 'setup_needed' : concerns.length ? 'attention' : 'live',
    headline: hm.size === 0 ? 'No health data yet — the body map activates with your first report.' : `${hm.size} metric(s) tracked${concerns.length ? `, ${concerns.length} concern(s) flagged` : ''}.`,
    items: [...hm.values()].slice(0, 6).map((h) => ({ label: h.metric, detail: h.level !== null ? `${h.level}/10${h.note ? ` — ${h.note.slice(0, 40)}` : ''}` : h.value || h.note.slice(0, 40), tone: h.concern ? 'warn' : 'ok' })),
    setupHint: 'Report a state: ingest kind=health_state (metric, level 0–10, note). Wearable/app connectors arrive in a later consent-gated phase.',
    jarvisCommand: 'Review my current situation.',
    metrics: [
      { label: 'tracked', value: String(hm.size), tone: hm.size ? 'ok' : 'neutral' },
      { label: 'concerns', value: String(concerns.length), tone: concerns.length ? 'warn' : 'ok' },
    ],
  });

  // 2 — Daily life / time / tasks
  const proposed = input.nextActions.filter((a) => a.status === 'proposed');
  const overdueLife = input.lifeItems.filter((l) => l.dueDate && l.dueDate < nowIso().slice(0, 10) && l.status === 'active');
  zones.push({
    zoneId: 'daily', title: 'Today & Priorities', href: '/me',
    status: proposed.length || input.latestBriefing ? 'live' : 'setup_needed',
    headline: proposed[0] ? `Top: ${proposed[0].title}` : 'No ranked priorities yet — build your baseline first.',
    items: [
      ...proposed.slice(0, 3).map((a) => ({ label: a.title.slice(0, 60), detail: `${a.category} · score ${a.priorityScore}`, tone: (a.category === 'risk' ? 'warn' : 'ok') as ZoneItem['tone'], href: '/me' })),
      ...(overdueLife.length ? [{ label: `${overdueLife.length} overdue personal item(s)`, detail: overdueLife[0]?.title ?? '', tone: 'err' as const }] : []),
      ...(g.pendingApprovals ? [{ label: `${g.pendingApprovals} approval(s) waiting`, detail: 'decisions unblock execution', tone: 'warn' as const, href: '/approvals' }] : []),
    ],
    setupHint: 'Calendar: not_configured (consent grant required). Priorities derive from your goals, risks and opportunities.',
    jarvisCommand: 'Run my daily briefing.',
    metrics: [
      { label: 'ranked', value: String(proposed.length), tone: proposed.length ? 'ok' : 'neutral' },
      { label: 'approvals', value: String(g.pendingApprovals), tone: g.pendingApprovals ? 'warn' : 'ok' },
    ],
  });

  // 3 — Family / home / personal world
  const lifeActive = input.lifeItems.filter((l) => l.status === 'active');
  const byDomain = new Map<string, number>();
  for (const l of lifeActive) byDomain.set(l.domain, (byDomain.get(l.domain) ?? 0) + 1);
  zones.push({
    zoneId: 'life', title: 'Family & Home', href: '/me/reality',
    status: lifeActive.length ? (lifeActive.some((l) => l.importance === 'high') ? 'attention' : 'live') : 'setup_needed',
    headline: lifeActive.length ? `${lifeActive.length} active item(s) across ${byDomain.size} domain(s).` : 'Your personal world is not mapped yet.',
    items: lifeActive.slice(0, 5).map((l) => ({ label: l.title.slice(0, 60), detail: `${l.domain} · ${l.itemType}${l.dueDate ? ` · due ${l.dueDate}` : ''}`, tone: l.importance === 'high' ? 'warn' : 'neutral' })),
    setupHint: 'Ingest kind=life_item (domain: family|home|relationship|household, title, importance, dueDate) to map responsibilities and concerns.',
    jarvisCommand: 'What should I do now?',
    metrics: [{ label: 'active', value: String(lifeActive.length), tone: lifeActive.length ? 'ok' : 'neutral' }, { label: 'high', value: String(lifeActive.filter((l) => l.importance === 'high').length), tone: 'warn' }],
  });

  // 4 — Finance
  const fin = aggregateFinance(input.financeItems);
  const finRisks = g.risks.filter((r) => r.tags.includes('financial') || /income|money|financ/i.test(r.title));
  zones.push({
    zoneId: 'finance', title: 'Money & Commitments', href: '/me/opportunities',
    status: input.financeItems.length === 0 ? 'setup_needed' : fin.net < 0 ? 'attention' : 'live',
    headline: input.financeItems.length === 0
      ? 'No financial structure recorded — amounts are never invented.'
      : fin.hasAmounts ? `Monthly: ${fin.monthlyIn} in / ${fin.monthlyOut} out → net ${fin.net}. ${fin.obligations} obligation(s).` : `${input.financeItems.length} item(s) recorded without amounts yet.`,
    items: [
      ...fin.upcoming.slice(0, 3).map((i) => ({ label: i.title.slice(0, 50), detail: `${i.itemType}${i.amount !== null ? ` · ${i.amount}${i.currency}` : ''} · due ${i.dueDate}`, tone: 'warn' as const })),
      ...finRisks.slice(0, 2).map((r) => ({ label: r.title.slice(0, 50), detail: `financial risk · ${r.severity}`, tone: 'err' as const })),
      ...g.opportunities.filter((o) => o.category === 'income' && o.status === 'proposed').slice(0, 2).map((o) => ({ label: o.title.slice(0, 50), detail: `income opportunity · impact ${o.impactScore}/10`, tone: 'ok' as const, href: '/me/opportunities' })),
    ],
    setupHint: 'Ingest kind=finance_item (itemType income|expense|bill|installment|obligation|investment, amount, cadence, dueDate). Bank connectors: not_configured (later, approval-gated).',
    jarvisCommand: 'Find the best opportunities for me based on my goals and current assets.',
    metrics: [
      { label: 'net/mo', value: fin.hasAmounts ? String(fin.net) : '—', tone: fin.net > 0 ? 'ok' : fin.hasAmounts ? 'err' : 'neutral' },
      { label: 'obligations', value: String(fin.obligations), tone: fin.obligations ? 'warn' : 'ok' },
    ],
  });

  // 5 — Businesses / projects / ventures
  const activeProjects = g.projects.filter((p) => p.status === 'active');
  zones.push({
    zoneId: 'ventures', title: 'Ventures & Projects', href: '/me/projects',
    status: activeProjects.length ? 'live' : 'setup_needed',
    headline: activeProjects.length ? `${activeProjects.length} active project(s); ${activeProjects.filter((p) => p.incomePotential === 'high').length} with high income potential.` : 'No ventures recorded yet.',
    items: activeProjects.slice(0, 5).map((p) => ({ label: p.title.slice(0, 55), detail: `income: ${p.incomePotential} · ${p.linkedGoalIds.length} goal link(s)`, tone: p.incomePotential === 'high' ? 'ok' : 'neutral', href: '/me/projects' })),
    setupHint: 'Ingest kind=project with incomePotential + linkedGoalIds. GitHub import: not_configured until token + consent.',
    jarvisCommand: 'Review my current situation.',
    metrics: [{ label: 'active', value: String(activeProjects.length), tone: activeProjects.length ? 'ok' : 'neutral' }, { label: 'high-income', value: String(activeProjects.filter((p) => p.incomePotential === 'high').length), tone: 'ok' }],
  });

  // 6 — Learning / growth / career
  const activeTracks = input.learningTracks.filter((t) => t.status === 'active');
  zones.push({
    zoneId: 'growth', title: 'Learning & Growth', href: '/me/resume',
    status: activeTracks.length || g.goals.length ? 'live' : 'setup_needed',
    headline: activeTracks.length ? `${activeTracks.length} learning track(s) active.` : g.goals.length ? 'Goals exist but no learning tracks — what should you learn next?' : 'No growth direction recorded yet.',
    items: activeTracks.slice(0, 4).map((t) => ({ label: t.title.slice(0, 55), detail: t.targetSkill ? `→ ${t.targetSkill}` : '', tone: 'ok' })),
    setupHint: 'Ingest kind=learning_track (title, targetSkill, linkedGoalIds); ask Jarvis “analyze my resume” for gap-driven suggestions.',
    jarvisCommand: 'Analyze my resume and tell me how to improve my position.',
    metrics: [{ label: 'tracks', value: String(activeTracks.length), tone: activeTracks.length ? 'ok' : 'neutral' }, { label: 'goals', value: String(g.goals.length), tone: g.goals.length ? 'ok' : 'warn' }],
  });

  // 7 — Investments / opportunities / strategic upside
  const rankedOpps = rankOpportunities(g.opportunities.filter((o) => ['proposed', 'accepted', 'in_progress'].includes(o.status)));
  zones.push({
    zoneId: 'opportunities', title: 'Opportunity Radar', href: '/me/opportunities',
    status: rankedOpps.length ? 'live' : 'setup_needed',
    headline: rankedOpps[0] ? `Top upside: “${rankedOpps[0].title}” (value ${rankedOpps[0].valueScore}).` : 'No upside recorded — research provider not_configured, nothing is invented.',
    items: rankedOpps.slice(0, 4).map((o) => ({ label: o.title.slice(0, 55), detail: `${o.category} · value ${o.valueScore} · conf ${o.confidence}`, tone: 'ok', href: '/me/opportunities' })),
    setupHint: 'Ingest opportunity candidates or accept AOS-proposed ones; real market research arrives with the research provider phase.',
    jarvisCommand: 'Find the best opportunities for me based on my goals and current assets.',
    metrics: [{ label: 'open', value: String(rankedOpps.length), tone: rankedOpps.length ? 'ok' : 'neutral' }, { label: 'top value', value: rankedOpps[0] ? String(rankedOpps[0].valueScore) : '—', tone: 'ok' }],
  });

  // 8 — Systems / infrastructure / AI kernel
  const k = input.kernel;
  zones.push({
    zoneId: 'systems', title: 'AI Kernel & Systems', href: '/operations',
    status: k.openIncidents > 0 ? 'attention' : 'live',
    headline: `${k.services} service(s) registered · ${k.openIncidents} open incident(s) · safe mode ${k.safeMode ? 'ON' : 'off'}${k.activeRuntimeGoal ? ` · operator: “${k.activeRuntimeGoal.slice(0, 50)}”` : ''}.`,
    items: [
      ...(k.activeOperation ? [{ label: 'Active operation', detail: k.activeOperation.slice(0, 70), tone: 'warn' as const, href: '/operations' }] : []),
      ...(k.pendingApprovals ? [{ label: `${k.pendingApprovals} approval(s) pending`, detail: 'kernel governance', tone: 'warn' as const, href: '/approvals' }] : []),
      ...k.recentEvents.slice(0, 3).map((e) => ({ label: e.slice(0, 70), detail: 'recent event', tone: 'neutral' as const, href: '/events' })),
    ],
    setupHint: 'The self-developing kernel is always live. Deep dive: Operations.',
    jarvisCommand: 'Check the whole system.',
    metrics: [
      { label: 'services', value: String(k.services), tone: 'ok' },
      { label: 'incidents', value: String(k.openIncidents), tone: k.openIncidents ? 'err' : 'ok' },
    ],
  });

  // 9 — Social / presence
  const social = input.connectors.filter((c) => ['social', 'twitter', 'x', 'linkedin', 'youtube', 'instagram', 'github'].includes(c.connectorType));
  zones.push({
    zoneId: 'presence', title: 'Presence & Channels', href: '/settings/connectors',
    status: social.length ? 'live' : 'not_configured',
    headline: social.length ? `${social.length} channel account(s) registered.` : 'No channels connected — presence intelligence activates with consented, read-only connectors.',
    items: social.slice(0, 4).map((c) => ({ label: c.connectorType, detail: c.status, tone: c.status === 'connected' ? 'ok' : 'neutral', href: '/settings/connectors' })),
    setupHint: 'Grant a read-only consent (POST /v1/consents, e.g. connectorType “linkedin”), then register the connector account. No writes, ever, without approval phases.',
    jarvisCommand: 'What should AOS build next to improve my life, income, and future position?',
    metrics: [{ label: 'channels', value: String(social.length), tone: social.length ? 'ok' : 'neutral' }, { label: 'writes', value: 'off', tone: 'ok' }],
  });

  return zones;
}

/* ==================== personal command classification =================== */

export type PersonalCommand = 'baseline' | 'what_now' | 'daily_briefing' | 'weekly_strategy' | 'resume' | 'opportunities' | 'aos_build' | 'none';

export function classifyPersonalCommand(text: string): PersonalCommand {
  const t = text.toLowerCase();
  if (/build my personal (reality )?baseline|review my current situation|personal growth plan/.test(t)) return 'baseline';
  if (/what should i do (now|next)|highest.value next action|next best action/.test(t)) return 'what_now';
  if (/(run |do )?my daily briefing|daily briefing/.test(t)) return 'daily_briefing';
  if (/weekly (strategy|review)|strategy review/.test(t)) return 'weekly_strategy';
  if (/resume|cv\b|my position(ing)?/.test(t)) return 'resume';
  if (/opportunit(y|ies).*(for me|my)|find .*opportunit|increase my income|system to increase/.test(t)) return 'opportunities';
  if (/what should aos build.*(me|my)|aos build next for me|improve my (life|income|future)/.test(t)) return 'aos_build';
  return 'none';
}
