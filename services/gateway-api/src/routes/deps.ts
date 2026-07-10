/**
 * GatewayDeps — the shared runtime surface handed to every route module
 * (K1.3 mechanical split). One flat object so moved route bodies stay
 * verbatim: modules destructure exactly the names they already used when
 * everything lived in one closure. Values are constructed in server.ts;
 * this file only declares their types.
 */

import type { ServiceContext } from '@factory/service-kit';
import {
  buildAuditLog, buildSecurityEvent, auditEnvironment, scoreNextActions,
  classifyGoalScope, RateLimiter,
} from '@factory/shared';
import type {
  AccessDecision,
  Approval,
  AuditLog,
  AuthContext,
  Capability,
  CapabilityGap,
  Collection,
  CompressedContext,
  DailyBriefing,
  DecisionMemory,
  DeploymentChecklist,
  DeploymentSnapshot,
  DokployApiDiagnostic,
  DokployClient,
  DokployTarget,
  Evaluation,
  EvidenceRecord,
  ExpansionProposal,
  GitHubOperation,
  ImpactAssessment,
  ImprovementWorkflow,
  Incident,
  InfrastructureRequest,
  IntelligenceReport,
  JarvisAnswerScore,
  JarvisContextFact,
  JarvisIntent,
  JarvisMemoryFact,
  JarvisTurn,
  LearningRun,
  LearningSchedule,
  LearningTrigger,
  LlmBudgetEvent,
  LlmCostRecord,
  LlmRouter,
  LlmTrace,
  MemoryMaintenanceRun,
  MemorySummary,
  MonitorRun,
  NextBestAction,
  OperationPlan,
  OperationalPattern,
  OperatorRuntimeMemory,
  OperatorRuntimeSession,
  OperatorRuntimeStep,
  OperatorTool,
  OperatorToolPermission,
  OperatorToolRun,
  OutcomeReview,
  Permission,
  PersonalAsset,
  PersonalBriefingRun,
  PersonalCareerRecord,
  PersonalGraphInput,
  PersonalIncomeStream,
  PersonalOpportunity,
  PersonalProject,
  PersonalRealityProfile,
  PersonalRisk,
  PersonalSystem,
  PlanScore,
  PlanStep,
  PolicyChangeProposal,
  PolicyDecision,
  PolicyRule,
  PromptPerformance,
  QaReport,
  RbacUser,
  ReliabilityScore,
  RepairDiagnosis,
  RepairPlan,
  RepairTask,
  ResearchReport,
  ResearchRun,
  ResearchSource,
  ResumeProfile,
  ReviewReport,
  Role,
  RoleName,
  RuntimeValidation,
  ScoringChangeProposal,
  ScoringProfile,
  SecurityCheck,
  SecurityEvent,
  ServiceActivation,
  Skill,
  StrategicPlan,
  StrategyReviewRun,
  SystemEvent,
  SystemRecommendation,
  Task,
  Tenant,
  UserGoal,
  VerificationResult,
  VoiceMemory,
  VoiceMessage,
  VoicePermission,
  VoiceSession,
  VoiceToolCall,
} from '@factory/shared';
import type { GatewayEnv } from '../server.js';

/** Request/reply structural types used by the shared guards (mirrors the
 *  pre-split closure-local aliases). */
export type Req = { headers: Record<string, string | string[] | undefined>; ip?: string };
export type FastifyReplyLike = { code: (n: number) => { send: (b: unknown) => unknown }; header: (k: string, v: unknown) => unknown };

export interface GatewayDeps {
  env: GatewayEnv;
  ctx: ServiceContext;
  guard: (req: { headers: Record<string, string | string[] | undefined> }) => boolean;
  deny: (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => unknown;
  headerStr: (req: Req, name: string) => string;
  clientIp: (req: Req) => string;
  userAgent: (req: Req) => string;
  declaredRole: (req: Req) => RoleName;
  writeAudit: (a: Parameters<typeof buildAuditLog>[0]) => Promise<AuditLog>;
  writeSecEvent: (e: Parameters<typeof buildSecurityEvent>[0]) => Promise<SecurityEvent>;
  rateLimited: (req: Req, reply: FastifyReplyLike, bucket: string) => Promise<boolean>;
  enforce: (action: string, req: Req, reply: FastifyReplyLike) => Promise<boolean>;
  envAuditInput: () => Parameters<typeof auditEnvironment>[0];
  isSafeMode: () => Promise<boolean>;
  SAFE_MODE_SETTING: string;
  mutationLimiter: RateLimiter;
  saveOp: (plan: OperationPlan) => Promise<OperationPlan>;
  executeViaApi: (plan: OperationPlan) => Promise<{ manualRequired: boolean }>;
  runVerification: (plan: OperationPlan) => Promise<VerificationResult>;
  TERMINAL: Set<string>;
  dokployClient: DokployClient | null;
  dokployApiConfigured: boolean;
  /** K1.3 deviation (documented): pre-split `let lastDokploySyncAt` became a
   *  shared state object so modules can read AND assign across the boundary. */
  dokploySync: { lastAt: string | null };
  voiceServiceUrl: () => string;
  createKernelTask: (goal: string, tags: string[]) => Promise<string>;
  loadGraphInput: (actor: AuthContext) => Promise<PersonalGraphInput>;
  userStamp: (actor: AuthContext) => Parameters<typeof scoreNextActions>[1];
  codeAgentTask: (action: string, input?: Record<string, unknown>, timeoutMs?: number) => Promise<{ ok: boolean; summary: string; data?: unknown }>;
  liveRegistry: () => Promise<OperatorTool[]>;
  executors: Record<string, (args: Record<string, unknown>, role: RoleName) => Promise<{ ok: boolean; summary: string; data?: unknown; evidenceIds?: string[] }>>;
  gatherJarvisFacts: (authCtx: AuthContext, scopeClass: ReturnType<typeof classifyGoalScope>, intentCategory: string) => Promise<JarvisContextFact[]>;
  composeAndRecordJarvisTurn: (args: { text: string; intent: JarvisIntent; authCtx: AuthContext; scopeClass: ReturnType<typeof classifyGoalScope>; mode: 'direct_answer' | 'route_to_planner'; planSummary?: string; forceFallback: boolean }) => Promise<{ reply: string; language: string; suggestedFollowUps: string[] }>;
  recordStep: (session: OperatorRuntimeSession, stepDef: PlanStep, narration: string, observation: string, status: string) => Promise<void>;
  runLoop: (session: OperatorRuntimeSession, role: RoleName, tools: OperatorTool[]) => Promise<OperatorRuntimeSession>;
  jarvisRouter: LlmRouter;
  jarvisGov: ReturnType<typeof import('@factory/shared').llmGovernanceFromEnv>;
  tasks: Collection<Task>;
  approvals: Collection<Approval>;
  infra: Collection<InfrastructureRequest>;
  events: Collection<SystemEvent>;
  capabilities: Collection<Capability>;
  gaps: Collection<CapabilityGap>;
  proposals: Collection<ExpansionProposal>;
  evaluations: Collection<Evaluation>;
  llmTraces: Collection<LlmTrace>;
  skills: Collection<Skill>;
  validations: Collection<RuntimeValidation>;
  githubOps: Collection<GitHubOperation>;
  evidence: Collection<EvidenceRecord>;
  activations: Collection<ServiceActivation>;
  checklists: Collection<DeploymentChecklist>;
  monitorRuns: Collection<MonitorRun>;
  incidents: Collection<Incident>;
  repairTasks: Collection<RepairTask>;
  repairDiagnoses: Collection<RepairDiagnosis>;
  repairPlans: Collection<RepairPlan>;
  strategicPlans: Collection<StrategicPlan>;
  planScores: Collection<PlanScore>;
  policyDecisions: Collection<PolicyDecision>;
  decisionMemories: Collection<DecisionMemory>;
  outcomeReviews: Collection<OutcomeReview>;
  scoringProfiles: Collection<ScoringProfile>;
  scoringProposals: Collection<ScoringChangeProposal>;
  policyRules: Collection<PolicyRule>;
  policyProposals: Collection<PolicyChangeProposal>;
  rolesCol: Collection<Role>;
  permsCol: Collection<Permission>;
  usersCol: Collection<RbacUser>;
  auditLogs: Collection<AuditLog>;
  learningRuns: Collection<LearningRun>;
  reliabilityScores: Collection<ReliabilityScore>;
  operationalPatterns: Collection<OperationalPattern>;
  memorySummaries: Collection<MemorySummary>;
  compressedContexts: Collection<CompressedContext>;
  systemRecommendations: Collection<SystemRecommendation>;
  promptPerformance: Collection<PromptPerformance>;
  learningSchedules: Collection<LearningSchedule>;
  learningTriggers: Collection<LearningTrigger>;
  improvementWorkflows: Collection<ImprovementWorkflow>;
  impactAssessments: Collection<ImpactAssessment>;
  memoryMaintenanceRuns: Collection<MemoryMaintenanceRun>;
  securityChecks: Collection<SecurityCheck>;
  securityEvents: Collection<SecurityEvent>;
  systemSettings: Collection<{ settingId: string; value: unknown; updatedAt: string }>;
  llmCostRecords: Collection<LlmCostRecord>;
  llmBudgetEvents: Collection<LlmBudgetEvent>;
  researchRuns: Collection<ResearchRun>;
  researchSources: Collection<ResearchSource>;
  researchReports: Collection<ResearchReport>;
  reviewReports: Collection<ReviewReport>;
  qaReports: Collection<QaReport>;
  intelligenceReports: Collection<IntelligenceReport>;
  operationPlans: Collection<OperationPlan>;
  dokployTargets: Collection<DokployTarget>;
  deploymentSnapshots: Collection<DeploymentSnapshot>;
  dokployDiagnostics: Collection<DokployApiDiagnostic>;
  voiceSessions: Collection<VoiceSession>;
  voiceMessages: Collection<VoiceMessage>;
  voiceToolCalls: Collection<VoiceToolCall>;
  voicePermissions: Collection<VoicePermission>;
  voiceMemories: Collection<VoiceMemory>;
  evidenceCol: Collection<EvidenceRecord>;
  jarvisTurns: Collection<JarvisTurn>;
  jarvisMemoryFacts: Collection<JarvisMemoryFact>;
  jarvisAnswerScores: Collection<JarvisAnswerScore>;
  jarvisBriefings: Collection<{ briefingId: string; actorId: string; scope: 'global' | 'user'; headline: string; narrative: string; topPriorities: string[]; decisions: string[]; blockers: string[]; suggestedFollowUps: string[]; language: string; createdAt: string }>;
  tenantsCol: Collection<Tenant>;
  // userProfiles/memberships/consentGrants/connectorAccounts/connectorSyncRuns
  // deliberately absent — K1.4f (D-163) migrated all five off the raw
  // GatewayDeps handle; routes/personal.ts builds scopedCollection(ctx)
  // accessors per-request instead (userProfileFor/membershipsFor/
  // consentGrantsFor/connectorAccountsFor/connectorSyncRunsFor). userProfiles
  // and consentGrants still have a raw LOCAL const in server.ts (not part of
  // GatewayDeps) for the owner-seed bootstrap and the Jarvis/operator
  // executors block — see decision-log D-163. Do not re-add any of the five
  // as a raw GatewayDeps handle.
  // scopedMemories deliberately absent — K1.4b (D-158) migrated it off the
  // raw GatewayDeps handle; routes.personal.ts builds a scopedCollection(ctx)
  // accessor per-request instead. Do not re-add a raw handle for it.
  userGoals: Collection<UserGoal>;
  dailyBriefings: Collection<DailyBriefing>;
  // opportunityReports deliberately absent — K1.4d (D-160) migrated it onto
  // scopedCollection(ctx), built per-request in routes/personal.ts.
  accessDecisions: Collection<AccessDecision>;
  realityProfiles: Collection<PersonalRealityProfile>;
  personalAssets: Collection<PersonalAsset>;
  personalProjects: Collection<PersonalProject>;
  personalSystems: Collection<PersonalSystem>;
  personalRisks: Collection<PersonalRisk>;
  personalOpportunities: Collection<PersonalOpportunity>;
  personalIncomeStreams: Collection<PersonalIncomeStream>;
  personalCareerRecords: Collection<PersonalCareerRecord>;
  resumeProfiles: Collection<ResumeProfile>;
  nextBestActions: Collection<NextBestAction>;
  // personalHealthStates/LifeItems/FinanceItems/LearningTracks deliberately
  // absent — K1.4c (D-159) migrated them off raw GatewayDeps handles onto
  // scopedCollection(ctx), built per-request in routes/personal.ts. Do not
  // re-add raw handles for them.
  personalBriefingRuns: Collection<PersonalBriefingRun>;
  strategyReviewRuns: Collection<StrategyReviewRun>;
  opTools: Collection<OperatorTool>;
  opToolRuns: Collection<OperatorToolRun>;
  opPermissions: Collection<OperatorToolPermission>;
  opSessions: Collection<OperatorRuntimeSession>;
  opSteps: Collection<OperatorRuntimeStep>;
  opMemories: Collection<OperatorRuntimeMemory>;
}
