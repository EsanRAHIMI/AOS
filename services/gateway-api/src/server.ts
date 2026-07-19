/**
 * Gateway API — service builder (K1.3 seam: bootstrap lives in index.ts).
 *
 * The single front door for the dashboard and external callers. Creates tasks,
 * exposes task/approval/infrastructure state, proxies the service registry, and
 * serves event history. Human/dashboard calls authenticate with the admin
 * token; service-to-service calls use the internal token. The gateway forwards
 * new goals to the orchestrator, which owns decomposition and coordination.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  RedisEnvSchema,
  AgentQueueEnvSchema,
  AgentTaskQueueClient,
  dispatchViaQueueOrHttp,
  type DispatchOutcome,
  createRedisBackbone,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  IMPORTANT_OPERATOR_EVENT_TYPES,
  INTERNAL_TOKEN_HEADER,
  ROLE_HEADER,
  REQUEST_ID_HEADER,
  peerUrl,
  resolvePeerUrl,
  TaskRequestSchema,
  hasValidInternalToken,
  hasValidAdminToken,
  success,
  failure,
  ERROR_CODES,
  genId,
  nowIso,
  auditEnvironment,
  buildSecurityCheck,
  buildSecurityEvent,
  RateLimiter,
  canRolePerformAction,
  isActionBlockedInSafeMode,
  agentPrompts,
  buildEvidence,
  buildOperationPlan,
  buildSnapshot,
  buildManualInstructions,
  classifyOperation,
  setStep,
  nextActionFor,
  isProtectedCore,
  canAutoExecute,
  dokployClientFromEnv,
  dokployConfigFromEnv,
  isDokployConfigured,
  redactSummary,
  buildDiagnostics,
  parseDokployTargets,
  mapAosServices,
  routeUtterance,
  normalizeUtterance,
  VOICE_GUARDRAILS,
  SERVICE_IDS,
  buildOperatorToolRegistry,
  buildCapabilityAnswer,
  planForGoal,
  isCapabilityQuestion,
  classifyToolFailure,
  narrateStep,
  stopSessionOnFailure,
  sortRecentSessions,
  canAccess,
  buildAccessDecision,
  stampScope,
  buildEsanSeed,
  legacyRoleToAuthContext,
  authContextToRoleName,
  classifyGoalScope,
  ESAN_TENANT_ID,
  ESAN_USER_ID,
  hashPassword,
  verifyPasswordHash,
  generateSessionToken,
  hashSessionToken,
  SESSION_TOKEN_HEADER,
  type AuthContext,
  type AccessRequest,
  type Tenant,
  type UserProfile,
  type TenantMembership,
  type ConsentGrant,
  type UserAccount,
  type Session,
  type UserGoal,
  type DailyBriefing,
  type AccessDecision,
  buildPersonalGraph,
  scoreNextActions,
  buildDailyBriefingRun,
  buildWeeklyStrategyRun,
  rankOpportunities,
  analyzeResume,
  nextConnectorFor,
  INGESTION_KINDS,
  type IngestionKind,
  type IngestionResult,
  type PersonalGraphInput,
  type PersonalRealityProfile,
  type PersonalAsset,
  type PersonalProject,
  type PersonalSystem,
  type PersonalRisk,
  type PersonalOpportunity,
  type PersonalIncomeStream,
  type PersonalCareerRecord,
  type ResumeProfile,
  type NextBestAction,
  type PersonalBriefingRun,
  type StrategyReviewRun,
  buildUniverseZones,
  aggregateFinance,
  type OperatorTool,
  type OperatorToolRun,
  type OperatorToolPermission,
  type OperatorRuntimeSession,
  type OperatorRuntimeStep,
  type OperatorRuntimeMemory,
  type PlanStep,
  type DokployApiDiagnostic,
  type DokployClient,
  type VoiceSession,
  type VoiceMessage,
  type VoiceToolCall,
  type VoicePermission,
  type VoiceMemory,
  type ToolProposal,
  type OperationPlan,
  type OperationStep,
  type OperationType,
  type DokployTarget,
  type DeploymentSnapshot,
  type VerificationResult,
  type SecurityCheck,
  type SecurityEvent,
  type LlmCostRecord,
  type LlmBudgetEvent,
  type ResearchRun,
  type ResearchSource,
  type ResearchReport,
  type ReviewReport,
  type QaReport,
  type IntelligenceReport,
  type Task,
  type Approval,
  type InfrastructureRequest,
  type SystemEvent,
  type Capability,
  type CapabilityGap,
  type ExpansionProposal,
  type Evaluation,
  type LlmTrace,
  type Skill,
  type RuntimeValidation,
  type GitHubOperation,
  type EvidenceRecord,
  llmStatusFromEnv,
  gitHubDeliveryFromEnv,
  webSearchStatusFromEnv,
  classifyResearchFetchFailure,
  interpretResearchTaskResponse,
  type ServiceActivation,
  type DeploymentChecklist,
  type MonitorRun,
  type Incident,
  type RepairTask,
  type RepairDiagnosis,
  type RepairPlan,
  type StrategicPlan,
  type PlanScore,
  type PolicyDecision,
  type DecisionMemory,
  buildScoringProfile,
  buildAuditLog,
  hasPermission,
  type ScoringProfile,
  type OutcomeReview,
  type ScoringChangeProposal,
  type PolicyRule,
  type PolicyChangeProposal,
  type Role,
  type Permission,
  type RbacUser,
  type AuditLog,
  type RoleName,
  type LearningRun,
  type ReliabilityScore,
  type OperationalPattern,
  type MemorySummary,
  type CompressedContext,
  type SystemRecommendation,
  type PromptPerformance,
  type LearningSchedule,
  type LearningTrigger,
  type ImprovementWorkflow,
  type ImpactAssessment,
  type MemoryMaintenanceRun,
  // Phase AD — Jarvis Intelligence Core & Living Command Home
  llmRouterFromEnv,
  llmGovernanceFromEnv,
  classifyIntent,
  decideJarvisMode,
  buildJarvisContextPacket,
  composeJarvisResponse,
  buildJarvisTurn,
  AOS_SELF_KNOWLEDGE,
  detectLanguage,
  type JarvisContextFact,
  type JarvisIntent,
  type JarvisTurn,
  // Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade
  extractMemoryFacts,
  buildMemoryFacts,
  type JarvisMemoryFact,
  buildDailyBrainPacket,
  composeDailyBriefing,
  type DailyBrainInput,
  scoreJarvisAnswer,
  type JarvisAnswerScore,
  composeTaskCompletionSummary,
  // Phase AE.1 — Jarvis Priority & Memory Correction
  pickActivePriorityFact,
  composeJarvisResponseFallback,
  answerIgnoresStatedPriority,
} from '@factory/shared';
import { createFactoryService, type FactoryService } from '@factory/service-kit';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTasksRoutes } from './routes/tasks.js';
import { registerAgentJobsRoutes } from './routes/agent-jobs.js';
import { registerJarvisRoutes } from './routes/jarvis.js';
import { registerCapabilitiesRoutes } from './routes/capabilities.js';
import { registerGovernanceRoutes } from './routes/governance.js';
import { registerSecurityRoutes } from './routes/security.js';
import { registerOperationsRoutes } from './routes/operations.js';
import { registerIntelligenceRoutes } from './routes/intelligence.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerPersonalRoutes } from './routes/personal.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerCinRoutes } from './routes/cin.js';
import { registerStreamRoutes } from './routes/stream.js';
import type { GatewayDeps } from './routes/deps.js';
import { manifest } from './factory/manifest.js';


// K1.3 seam — the gateway is buildable without listening (and, for tests,
// without a real Mongo connection via the shared setTestDb seam). index.ts
// is the only caller in production; characterization tests are the other.
export const GatewayEnvSchema = BaseEnvSchema.merge(MongoEnvSchema).merge(RedisEnvSchema).merge(AgentQueueEnvSchema);
export type GatewayEnv = ReturnType<(typeof GatewayEnvSchema)['parse']>;

export interface BuildGatewayOptions {
  /** Skip connectMongo (tests inject a Db via setTestDb first). Default: connect. */
  connectDb?: boolean;
}

export async function buildGatewayService(env: GatewayEnv, opts: BuildGatewayOptions = {}): Promise<FactoryService> {
  if (opts.connectDb !== false) {
    await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  }
  const tasks = collection<Task>(COLLECTIONS.TASKS);
  const approvals = collection<Approval>(COLLECTIONS.APPROVALS);
  const infra = collection<InfrastructureRequest>(COLLECTIONS.INFRASTRUCTURE_REQUESTS);
  const events = collection<SystemEvent>(COLLECTIONS.EVENTS);
  const capabilities = collection<Capability>(COLLECTIONS.CAPABILITIES);
  const gaps = collection<CapabilityGap>(COLLECTIONS.CAPABILITY_GAPS);
  const proposals = collection<ExpansionProposal>(COLLECTIONS.EXPANSION_PROPOSALS);
  const evaluations = collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS);
  const llmTraces = collection<LlmTrace>(COLLECTIONS.LLM_TRACES);
  const skills = collection<Skill>(COLLECTIONS.SKILLS);
  const validations = collection<RuntimeValidation>(COLLECTIONS.RUNTIME_VALIDATIONS);
  const githubOps = collection<GitHubOperation>(COLLECTIONS.GITHUB_OPERATIONS);
  const evidence = collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS);
  const activations = collection<ServiceActivation>(COLLECTIONS.SERVICE_ACTIVATIONS);
  const checklists = collection<DeploymentChecklist>(COLLECTIONS.DEPLOYMENT_CHECKLISTS);
  const monitorRuns = collection<MonitorRun>(COLLECTIONS.MONITOR_RUNS);
  const incidents = collection<Incident>(COLLECTIONS.INCIDENTS);
  const repairTasks = collection<RepairTask>(COLLECTIONS.REPAIR_TASKS);
  const repairDiagnoses = collection<RepairDiagnosis>(COLLECTIONS.REPAIR_DIAGNOSES);
  const repairPlans = collection<RepairPlan>(COLLECTIONS.REPAIR_PLANS);
  const strategicPlans = collection<StrategicPlan>(COLLECTIONS.STRATEGIC_PLANS);
  const planScores = collection<PlanScore>(COLLECTIONS.PLAN_SCORES);
  const policyDecisions = collection<PolicyDecision>(COLLECTIONS.POLICY_DECISIONS);
  const decisionMemories = collection<DecisionMemory>(COLLECTIONS.DECISION_MEMORIES);
  const outcomeReviews = collection<OutcomeReview>(COLLECTIONS.OUTCOME_REVIEWS);
  const scoringProfiles = collection<ScoringProfile>(COLLECTIONS.SCORING_PROFILES);
  const scoringProposals = collection<ScoringChangeProposal>(COLLECTIONS.SCORING_CHANGE_PROPOSALS);
  const policyRules = collection<PolicyRule>(COLLECTIONS.POLICY_RULES);
  const policyProposals = collection<PolicyChangeProposal>(COLLECTIONS.POLICY_CHANGE_PROPOSALS);
  const rolesCol = collection<Role>(COLLECTIONS.ROLES);
  const permsCol = collection<Permission>(COLLECTIONS.PERMISSIONS);
  const usersCol = collection<RbacUser>(COLLECTIONS.USERS);
  const auditLogs = collection<AuditLog>(COLLECTIONS.AUDIT_LOGS);
  const learningRuns = collection<LearningRun>(COLLECTIONS.LEARNING_RUNS);
  const reliabilityScores = collection<ReliabilityScore>(COLLECTIONS.RELIABILITY_SCORES);
  const operationalPatterns = collection<OperationalPattern>(COLLECTIONS.OPERATIONAL_PATTERNS);
  const memorySummaries = collection<MemorySummary>(COLLECTIONS.MEMORY_SUMMARIES);
  const compressedContexts = collection<CompressedContext>(COLLECTIONS.COMPRESSED_CONTEXTS);
  const systemRecommendations = collection<SystemRecommendation>(COLLECTIONS.SYSTEM_RECOMMENDATIONS);
  const promptPerformance = collection<PromptPerformance>(COLLECTIONS.PROMPT_PERFORMANCE);
  const learningSchedules = collection<LearningSchedule>(COLLECTIONS.LEARNING_SCHEDULES);
  const learningTriggers = collection<LearningTrigger>(COLLECTIONS.LEARNING_TRIGGERS);
  const improvementWorkflows = collection<ImprovementWorkflow>(COLLECTIONS.IMPROVEMENT_WORKFLOWS);
  const impactAssessments = collection<ImpactAssessment>(COLLECTIONS.IMPACT_ASSESSMENTS);
  const memoryMaintenanceRuns = collection<MemoryMaintenanceRun>(COLLECTIONS.MEMORY_MAINTENANCE_RUNS);
  const securityChecks = collection<SecurityCheck>(COLLECTIONS.SECURITY_CHECKS);
  const securityEvents = collection<SecurityEvent>(COLLECTIONS.SECURITY_EVENTS);
  const systemSettings = collection<{ settingId: string; value: unknown; updatedAt: string }>(COLLECTIONS.SYSTEM_SETTINGS);
  // Phase 13 — intelligence collections
  const llmCostRecords = collection<LlmCostRecord>(COLLECTIONS.LLM_COST_RECORDS);
  const llmBudgetEvents = collection<LlmBudgetEvent>(COLLECTIONS.LLM_BUDGET_EVENTS);
  const researchRuns = collection<ResearchRun>(COLLECTIONS.RESEARCH_RUNS);
  const researchSources = collection<ResearchSource>(COLLECTIONS.RESEARCH_SOURCES);
  const researchReports = collection<ResearchReport>(COLLECTIONS.RESEARCH_REPORTS);
  const reviewReports = collection<ReviewReport>(COLLECTIONS.REVIEW_REPORTS);
  const qaReports = collection<QaReport>(COLLECTIONS.QA_REPORTS);
  const intelligenceReports = collection<IntelligenceReport>(COLLECTIONS.INTELLIGENCE_REPORTS);
  // Phase 15 — Safe Real Operations
  const operationPlans = collection<OperationPlan>(COLLECTIONS.OPERATION_PLANS);
  const dokployTargets = collection<DokployTarget>(COLLECTIONS.DOKPLOY_TARGETS);
  const deploymentSnapshots = collection<DeploymentSnapshot>(COLLECTIONS.DEPLOYMENT_SNAPSHOTS);
  const dokployDiagnostics = collection<DokployApiDiagnostic>(COLLECTIONS.DOKPLOY_API_DIAGNOSTICS);
  // Phase 18 — voice operator
  const voiceSessions = collection<VoiceSession>(COLLECTIONS.VOICE_SESSIONS);
  const voiceMessages = collection<VoiceMessage>(COLLECTIONS.VOICE_MESSAGES);
  const voiceToolCalls = collection<VoiceToolCall>(COLLECTIONS.VOICE_TOOL_CALLS);
  const voicePermissions = collection<VoicePermission>(COLLECTIONS.VOICE_PERMISSIONS);
  const voiceMemories = collection<VoiceMemory>(COLLECTIONS.VOICE_MEMORIES);
  const evidenceCol = collection<EvidenceRecord>(COLLECTIONS.EVIDENCE_RECORDS);
  // Phase AD — Jarvis Intelligence Core
  const jarvisTurns = collection<JarvisTurn>(COLLECTIONS.JARVIS_TURNS);
  const jarvisRouter = llmRouterFromEnv();
  const jarvisGov = llmGovernanceFromEnv();
  // Phase AE — Jarvis Memory, Daily Brain & Real Context Upgrade
  const jarvisMemoryFacts = collection<JarvisMemoryFact>(COLLECTIONS.JARVIS_MEMORY_FACTS);
  const jarvisAnswerScores = collection<JarvisAnswerScore>(COLLECTIONS.JARVIS_ANSWER_SCORES);
  const jarvisBriefings = collection<{ briefingId: string; actorId: string; scope: 'global' | 'user'; headline: string; narrative: string; topPriorities: string[]; decisions: string[]; blockers: string[]; suggestedFollowUps: string[]; language: string; createdAt: string }>(COLLECTIONS.JARVIS_BRIEFINGS);
  await tasks.createIndex({ taskId: 1 }, { unique: true });
  await approvals.createIndex({ approvalId: 1 }, { unique: true });
  await infra.createIndex({ requestId: 1 }, { unique: true });

  // Seed the runtime safe-mode setting from env on first boot (env = default).
  const SAFE_MODE_SETTING = 'safe_mode';
  if (!(await systemSettings.findOne({ settingId: SAFE_MODE_SETTING }))) {
    await systemSettings.insertOne({ settingId: SAFE_MODE_SETTING, value: env.AUTONOMY_SAFE_MODE, updatedAt: nowIso() });
  }
  const isSafeMode = async (): Promise<boolean> => {
    const s = await systemSettings.findOne({ settingId: SAFE_MODE_SETTING });
    return Boolean(s?.value);
  };

  // K1 Redis Backbone (D-167): when REDIS_URL is configured, rate-limit
  // counters are shared across every gateway-api instance pointed at the
  // same Redis — closing the "N replicas each enforce their own budget"
  // gap. Falls back to the original local in-process counting (byte-
  // identical to before this change) when REDIS_URL is unset or a Redis
  // call fails. `ctx.log` isn't constructed yet at this point in boot, so a
  // plain console fallback is used for the (at-most-once) degraded warning.
  const redisBackbone = createRedisBackbone({
    url: env.REDIS_URL,
    keyPrefix: env.REDIS_KEY_PREFIX,
    logger: { warn: (obj, msg) => console.warn(`[gateway-api] ${msg ?? ''}`, obj) },
  });
  const mutationLimiter = new RateLimiter(60, 60_000, redisBackbone);
  setInterval(() => mutationLimiter.sweep(), 120_000).unref?.();

  // K1 BullMQ Producer Adoption (D-174): one queue client for gateway's own
  // dispatch-to-orchestrator call sites. `AGENT_DISPATCH_MODE=http` (the
  // default) means this is constructed but never actually used — see
  // `dispatchTaskToOrchestrator` below and decision-log D-174. No `publish`
  // callback here: `ctx` (and therefore `ctx.publisher`) doesn't exist yet
  // at this point in boot, so this process's own AGENT_JOB_* lifecycle
  // events (Mongo tracking of THIS queue client's own enqueues) aren't
  // published to the event bus — a minor, documented gap, not a functional
  // one (the job's `agent_job_runs` Mongo row is unaffected). The dispatch
  // degraded/mode events that matter for THIS workstream's requirement 3
  // (AGENT_DISPATCH_DEGRADED) are published per-call from inside the route
  // handlers below, where `ctx` is available.
  const agentQueueClient = new AgentTaskQueueClient({
    redisUrl: env.REDIS_URL,
    maxAttempts: env.AGENT_QUEUE_MAX_ATTEMPTS,
    backoffMs: env.AGENT_QUEUE_BACKOFF_MS,
  });

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    routes: (app, ctx) => {
      // Echo the request id on every response for traceability.
      app.addHook('onSend', (req, reply, payload, done) => {
        reply.header(REQUEST_ID_HEADER, String(req.id));
        done(null, payload);
      });
      // Production-safe error envelope: never leak stack traces to clients.
      app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
        const requestId = String(req.id);
        ctx.log.error({ err, requestId }, 'unhandled request error');
        const statusCode = err.statusCode ?? 500;
        const isProd = env.NODE_ENV === 'production';
        const code = statusCode >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION;
        const message = statusCode >= 500 && isProd ? 'internal error' : err.message;
        reply.header(REQUEST_ID_HEADER, requestId);
        reply.code(statusCode).send(failure(code, message, { requestId }));
      });

      // K1 Redis Backbone (D-167): release the Redis connection cleanly on
      // shutdown. A no-op when Redis was never enabled/connected.
      app.addHook('onClose', async () => {
        await redisBackbone.quit();
      });

      // K1 Real Auth production safety rail (D-164/D-165): make the legacy
      // fallback's risk visible at boot instead of silent. Non-blocking —
      // this is a visibility aid, not an enforcement gate; enforcement is
      // FACTORY_ALLOW_LEGACY_ROLE_AUTH itself.
      if (env.FACTORY_ENV === 'production' && env.FACTORY_ALLOW_LEGACY_ROLE_AUTH) {
        ctx.log.warn(
          '[K1 Real Auth] FACTORY_ALLOW_LEGACY_ROLE_AUTH is enabled in production. The ' +
            'x-factory-admin-token + x-factory-role fallback is temporary K1 compatibility ' +
            'scaffolding (decision-log D-164) — a shared secret can currently claim any role ' +
            'for any caller with no real session. Once every legacy caller (dashboard-web\'s ' +
            'bridge: decision-log D-165, CI, internal tooling) is confirmed using real gateway ' +
            'sessions, set FACTORY_ALLOW_LEGACY_ROLE_AUTH=false.',
        );
      }

      // --- Phase 12 security helpers --------------------------------------
      // K1 Real Auth (D-164): sessionActor moved into the Req type itself
      // (routes/deps.ts) so guard()/declaredRole() below can read it —
      // populated once per request by the onRequest hook registered further
      // down, right after the session/user-account collections exist.
      type Req = { headers: Record<string, string | string[] | undefined>; ip?: string; sessionActor?: AuthContext | null };
      type FastifyReplyLike = { code: (n: number) => { send: (b: unknown) => unknown }; header: (k: string, v: unknown) => unknown };
      const headerStr = (req: Req, name: string): string => {
        const v = req.headers[name];
        return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
      };
      const clientIp = (req: Req): string => headerStr(req, 'x-forwarded-for').split(',')[0]?.trim() || req.ip || '';
      const userAgent = (req: Req): string => headerStr(req, 'user-agent');

      // Dashboard/human (real session, OR legacy admin token) OR another
      // service (internal token). K1 Real Auth (D-164): a real, valid session
      // (req.sessionActor, resolved by the onRequest hook below) is now a
      // first-class way to pass guard() — it does not require the admin
      // token at all, which is the whole point (per-caller, revocable
      // identity instead of one shared secret).
      const guard = (req: Req) =>
        Boolean(req.sessionActor?.primaryUserId) ||
        hasValidAdminToken({
          headers: req.headers,
          expectedInternalToken: env.FACTORY_INTERNAL_TOKEN,
          expectedAdminToken: env.FACTORY_ADMIN_TOKEN,
        }) ||
        hasValidInternalToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN });

      const deny = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
        reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'admin or internal token required'));

      /**
       * The role the request acts as. K1 Real Auth (D-164), in priority order:
       *  1. A session token was declared (x-factory-session-token present).
       *     This is now the ONLY signal trusted for that request: a valid
       *     session maps to its real RoleName; an invalid/expired/revoked one
       *     resolves to 'agent' (fail closed) — it never falls through to the
       *     legacy header below, which would silently mask an expired session
       *     as if it were a fresh legacy request.
       *  2. No session token declared: the LEGACY path — self-declared
       *     x-factory-role, trusted only alongside a valid admin token. This
       *     is explicitly temporary K1 compatibility scaffolding (CI,
       *     existing internal tooling, the dashboard's own transition
       *     period) — see FACTORY_ALLOW_LEGACY_ROLE_AUTH and decision-log
       *     D-164 for the deprecation path. When disabled, an admin-token
       *     request with no real session resolves to the LEAST-privileged
       *     role ('viewer'), never the self-declared one — the whole point
       *     of the kill-switch is that a shared secret can no longer be used
       *     to claim an arbitrary identity.
       */
      const declaredRole = (req: Req): RoleName => {
        if (req.sessionActor !== undefined) return req.sessionActor ? authContextToRoleName(req.sessionActor) : 'agent';
        const isAdmin = hasValidAdminToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN, expectedAdminToken: env.FACTORY_ADMIN_TOKEN });
        if (!isAdmin) return 'agent';
        if (!env.FACTORY_ALLOW_LEGACY_ROLE_AUTH) return 'viewer';
        const r = headerStr(req, ROLE_HEADER);
        return (['owner', 'operator', 'viewer', 'agent'] as const).includes(r as RoleName) ? (r as RoleName) : 'owner';
      };
      /** K1 Real Auth (D-164): the ONE centralized place that resolves "who is
       *  making this request" into a full AuthContext — a real session if one
       *  was declared (valid or not — see declaredRole's doc), else the
       *  unchanged legacy legacyRoleToAuthContext(declaredRole(req)) mapping.
       *  routes/personal.ts and routes/auth.ts both use this via GatewayDeps
       *  instead of reconstructing the fallback logic themselves. */
      const resolveAuth = (req: Req): AuthContext => {
        if (req.sessionActor !== undefined) {
          return req.sessionActor ?? { actorId: 'invalid_session', actorType: 'service_agent', roles: [], permissions: [], scopes: [], isOwner: false };
        }
        return legacyRoleToAuthContext(declaredRole(req));
      };
      const writeAudit = async (a: Parameters<typeof buildAuditLog>[0]): Promise<AuditLog> => {
        const logRec = buildAuditLog(a);
        await auditLogs.insertOne(logRec);
        await ctx.publisher.publish({ type: EVENT_TYPES.AUDIT_LOGGED, taskId: null, payload: { action: logRec.action, targetId: logRec.targetId, actorId: logRec.actorId } });
        return logRec;
      };
      const writeSecEvent = async (e: Parameters<typeof buildSecurityEvent>[0]): Promise<SecurityEvent> => {
        const rec = buildSecurityEvent(e);
        await securityEvents.insertOne(rec);
        return rec;
      };
      // Fixed-window rate limit for a sensitive mutation. Returns true if blocked (already replied).
      const rateLimited = async (req: Req, reply: FastifyReplyLike, bucket: string): Promise<boolean> => {
        const res = await mutationLimiter.check(`${bucket}:${declaredRole(req)}:${clientIp(req)}`);
        if (res.allowed) return false;
        reply.header(REQUEST_ID_HEADER, headerStr(req, REQUEST_ID_HEADER));
        await writeSecEvent({ eventType: EVENT_TYPES.RATE_LIMITED, actorId: declaredRole(req), role: declaredRole(req), ip: clientIp(req), userAgent: userAgent(req), target: bucket, result: 'denied', riskLevel: 'medium', detail: 'rate limit exceeded' });
        reply.code(429).send(failure(ERROR_CODES.RATE_LIMITED, 'rate limit exceeded; please slow down'));
        return true;
      };
      // RBAC + safe-mode enforcement for a sensitive mutation. Returns true if denied (already replied).
      const enforce = async (action: string, req: Req, reply: FastifyReplyLike): Promise<boolean> => {
        const role = declaredRole(req);
        const actorType: AuditLog['actorType'] = role === 'agent' ? 'agent' : 'human';
        if (isActionBlockedInSafeMode(action) && (await isSafeMode())) {
          await writeAudit({ actorType, actorId: role, role, action: `${action}_blocked_safe_mode`, targetType: 'safe_mode', targetId: action, reason: 'AUTONOMY_SAFE_MODE active' });
          await writeSecEvent({ eventType: EVENT_TYPES.SAFE_MODE_CHANGED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: action, result: 'denied', riskLevel: 'high', detail: 'mutation blocked: safe mode active' });
          reply.code(403).send(failure(ERROR_CODES.SAFE_MODE, 'safe mode is active — mutation actions are disabled'));
          return true;
        }
        if (!canRolePerformAction(role, action)) {
          await writeAudit({ actorType, actorId: role, role, action: `${action}_denied`, targetType: 'rbac', targetId: action, reason: `role ${role} lacks permission` });
          await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: action, result: 'denied', riskLevel: 'medium', detail: `role ${role} cannot perform ${action}` });
          reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} is not permitted to ${action}`));
          return true;
        }
        return false;
      };

      // --- Phase 12: Security & production hardening ---------------------
      const envAuditInput = () => ({
        nodeEnv: env.NODE_ENV,
        factoryEnv: env.FACTORY_ENV,
        internalToken: env.FACTORY_INTERNAL_TOKEN,
        adminToken: env.FACTORY_ADMIN_TOKEN,
        sessionSecret: process.env.DASHBOARD_SESSION_SECRET,
        mongoUri: env.MONGODB_URI,
        s3: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, bucket: process.env.AWS_S3_BUCKET, region: process.env.AWS_REGION },
        llm: { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY },
        githubToken: process.env.GITHUB_TOKEN,
      });
      // --- Phase 15/16: Safe Real Operations -----------------------------
      const dokployApiConfigured = isDokployConfigured();
      const dokployClient: DokployClient | null = dokployClientFromEnv();
      // K1.3 deviation (documented in deps.ts): shared mutable sync marker as a
      // state object so the operations module can read/assign across the boundary.
      const dokploySync: { lastAt: string | null } = { lastAt: null };
      const TERMINAL = new Set(['completed', 'failed', 'rolled_back', 'cancelled']);

      // Execute the supported Dokploy API steps for an approved, auto-executable plan.
      // Unsupported/failed steps become `manual_required` (never a faked success).
      const executeViaApi = async (plan: OperationPlan): Promise<{ manualRequired: boolean }> => {
        if (!dokployClient) return { manualRequired: true };
        let manualRequired = false;
        const record = (key: string, r: { ok: boolean; status: number; error?: string; unsupported?: boolean }, apiMethod: string, requestSummary: string): void => {
          if (r.ok) {
            plan.steps = plan.steps.map((s) => (s.key === key ? { ...s, status: 'done', executionMode: 'api', apiMethod, requestSummary, responseSummary: `ok (${r.status})`, error: '', at: nowIso() } : s));
          } else if (r.unsupported) {
            manualRequired = true;
            plan.steps = plan.steps.map((s) => (s.key === key ? { ...s, status: 'manual_required', executionMode: 'manual', apiMethod, requestSummary, responseSummary: '', error: r.error ?? 'unsupported', retryable: false, at: nowIso() } : s));
          } else {
            manualRequired = true;
            plan.steps = plan.steps.map((s) => (s.key === key ? { ...s, status: 'manual_required', executionMode: 'manual', apiMethod, requestSummary, responseSummary: '', error: (r.error ?? 'failed').slice(0, 200), retryable: true, at: nowIso() } : s));
          }
        };
        try {
          if (plan.operationType === 'new_app') {
            const create = await dokployClient.createApplication({ name: plan.targetApp || plan.targetService, projectId: plan.targetProject || undefined, domain: plan.targetDomain, port: plan.targetPort, rootDir: plan.rootDir });
            record('execute', create, 'application.create', redactSummary({ name: plan.targetApp, domain: plan.targetDomain, port: plan.targetPort, rootDir: plan.rootDir }));
            const appId = String((create.data as { applicationId?: string } | undefined)?.applicationId ?? plan.targetApp);
            if (create.ok) {
              const deploy = await dokployClient.deployApplication(appId);
              record('run', deploy, 'application.deploy', redactSummary({ applicationId: appId }));
            } else { plan.steps = setStep(plan.steps, 'run', 'manual_required', 'Create the app manually, then deploy'); }
          } else if (plan.operationType === 'existing_app_restart') {
            const appId = plan.targetApp || plan.targetService;
            const r = await dokployClient.restartApplication(appId);
            record('execute', r, 'application.reload', redactSummary({ applicationId: appId }));
            plan.steps = setStep(plan.steps, 'run', r.ok ? 'done' : 'manual_required', r.ok ? 'Restarted' : 'Restart manually');
          } else if (plan.operationType === 'existing_app_repair') {
            const appId = plan.targetApp || plan.targetService;
            const r = await dokployClient.deployApplication(appId);
            record('execute', r, 'application.deploy', redactSummary({ applicationId: appId }));
            plan.steps = setStep(plan.steps, 'run', r.ok ? 'done' : 'manual_required', r.ok ? 'Redeployed' : 'Redeploy manually');
          } else {
            manualRequired = true;
          }
        } catch (e) {
          manualRequired = true;
          plan.steps = setStep(plan.steps, 'execute', 'manual_required', `API error: ${e instanceof Error ? e.message : 'unknown'}`);
        }
        return { manualRequired };
      };

      // Real verification: HTTP /health + registry presence. Never fabricated.
      const runVerification = async (plan: OperationPlan): Promise<VerificationResult> => {
        const res: VerificationResult = { domainReachable: null, healthOk: null, registered: null, manifestAvailable: null, detail: '', checkedAt: nowIso() };
        if (plan.targetDomain) {
          const base = (plan.targetDomain.startsWith('http') ? plan.targetDomain : `https://${plan.targetDomain}`).replace(/\/$/, '');
          try {
            const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
            res.domainReachable = true; res.healthOk = r.ok;
          } catch { res.domainReachable = false; res.healthOk = false; }
        }
        if (plan.targetService) {
          try { const svc = await ctx.registry.resolve(plan.targetService); res.registered = Boolean(svc); res.manifestAvailable = svc ? true : null; } catch { res.registered = false; }
        }
        res.detail = `health ${res.healthOk === null ? 'n/a' : res.healthOk ? 'ok' : 'failed'}; registry ${res.registered === null ? 'n/a' : res.registered ? 'registered' : 'not registered'}`;
        return res;
      };
      const saveOp = async (plan: OperationPlan): Promise<OperationPlan> => {
        plan.nextAction = nextActionFor(plan); plan.updatedAt = nowIso();
        await operationPlans.updateOne({ operationPlanId: plan.operationPlanId }, { $set: plan }, { upsert: true });
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_UPDATED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, status: plan.status, message: `Operation ${plan.status}: ${plan.goal}` } });
        return plan;
      };

      // --- Phase 18: Voice Operator --------------------------------------
      const voiceServiceUrl = (): string => env.SERVICE_REGISTRY_URL ? peerUrl('voice-operator-agent') : peerUrl('voice-operator-agent');
      // Create a real kernel task (learning/security/research) and forward to the orchestrator.
      const createKernelTask = async (goal: string, tags: string[]): Promise<string> => {
        const now = nowIso();
        const task: Task = { taskId: genId('task'), goal, status: 'queued', priority: 'normal', createdBy: 'voice-operator-agent', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags, error: null, createdAt: now, updatedAt: now };
        await tasks.insertOne(task);
        await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: task.taskId, payload: { goal } });
        const orch = await ctx.registry.resolve('orchestrator-agent');
        try {
          await fetch(`${(orch?.domain ?? peerUrl('orchestrator-agent'))}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ taskId: task.taskId, goal, input: {} }) });
          await tasks.updateOne({ taskId: task.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch { /* task persists regardless */ }
        return task.taskId;
      };

      // K1 BullMQ Producer Adoption (D-174) — the ONE place all 4 gateway→
      // orchestrator "fire-and-forget" call sites (routes/tasks.ts,
      // routes/capabilities.ts's build-from-proposal branch, routes/
      // governance.ts x2) now go through, instead of each duplicating a
      // fetch-then-catch block. `httpDispatch` below preserves the EXACT
      // pre-D-174 behavior on purpose: the original code never checked
      // `res.ok` — any non-throwing fetch (even a non-2xx response) was
      // treated as "forwarded", only a network-level exception (refused/
      // timeout/DNS) counted as a real failure. Changing that now would be
      // a silent behavior change unrelated to this workstream, so it's
      // preserved verbatim here rather than "fixed" as a side effect.
      // Byte-identical to before D-174 when AGENT_DISPATCH_MODE=http (the
      // default) — see dispatchViaQueueOrHttp in @factory/shared.
      const dispatchTaskToOrchestrator = async (args: {
        taskId: string;
        goal: string;
        input?: Record<string, unknown>;
        priority?: Task['priority'];
      }): Promise<DispatchOutcome> => {
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        const body = { taskId: args.taskId, goal: args.goal, input: args.input ?? {}, priority: args.priority ?? 'normal' as const };
        const outcome = await dispatchViaQueueOrHttp({
          serviceId: 'orchestrator-agent',
          body,
          mode: env.AGENT_DISPATCH_MODE,
          queueClient: agentQueueClient,
          publish: (e) => ctx.publisher.publish(e),
          httpDispatch: async () => {
            try {
              await fetch(`${orchestratorUrl}/.factory/task`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
                body: JSON.stringify(body),
              });
              return { ok: true, status: 200 };
            } catch (e) {
              return { ok: false, status: 0, error: e instanceof Error ? e.message : 'request failed' };
            }
          },
        });
        if (outcome.ok) {
          await tasks.updateOne(
            { taskId: args.taskId },
            { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', dispatchMode: outcome.dispatchMode, updatedAt: nowIso() } },
          );
        } else {
          ctx.log.warn({ err: outcome.error, dispatchMode: outcome.dispatchMode, taskId: args.taskId }, 'orchestrator forward failed; task remains queued');
          await tasks.updateOne({ taskId: args.taskId }, { $set: { dispatchMode: outcome.dispatchMode, updatedAt: nowIso() } });
        }
        return outcome;
      };

      // Compact, secret-free context packet for the voice operator.
      const tenantsCol = collection<Tenant>(COLLECTIONS.TENANTS);
      // userProfiles/memberships/consentGrants remain LOCAL raw handles —
      // K1.4f (D-163): no longer part of GatewayDeps (routes/personal.ts uses
      // scopedCollection(ctx) instead), but still needed right here for the
      // owner-seed bootstrap below (all three) and the Jarvis/operator
      // executors block further down (userProfiles, consentGrants) — that
      // subsystem is out of scope for this session. See decision-log D-163.
      const userProfiles = collection<UserProfile>(COLLECTIONS.USER_PROFILES);
      const memberships = collection<TenantMembership>(COLLECTIONS.TENANT_MEMBERSHIPS);
      const consentGrants = collection<ConsentGrant>(COLLECTIONS.CONSENT_GRANTS);
      // connectorAccounts/connectorSyncRuns deliberately have no raw handle
      // anywhere — K1.4f (D-163) fully migrated them to scopedCollection(ctx)
      // in routes/personal.ts. Do not reintroduce a raw handle for either.
      // scoped_memories deliberately has no raw handle here — K1.4b (D-158)
      // moved it to scopedCollection(ctx), built per-request in routes/personal.ts.
      const userGoals = collection<UserGoal>(COLLECTIONS.USER_GOALS);
      const dailyBriefings = collection<DailyBriefing>(COLLECTIONS.DAILY_BRIEFINGS);
      // opportunity_reports deliberately has no raw handle here — K1.4d
      // (D-160) moved it to scopedCollection(ctx) in routes/personal.ts.
      const accessDecisions = collection<AccessDecision>(COLLECTIONS.ACCESS_DECISIONS);

      // K1 Real Auth (D-164): credentials + sessions. user_accounts stores
      // ONLY credentials (userId/email/passwordHash) — never conflated with
      // user_profiles (personal profile data) or the decorative `users`/
      // RbacUser collection (governance.ts, unrelated demo/display data).
      const userAccounts = collection<UserAccount>(COLLECTIONS.USER_ACCOUNTS);
      const sessionsCol = collection<Session>(COLLECTIONS.SESSIONS);

      /** Resolve a bearer session token to a real AuthContext. Fails closed
       *  (returns null) on any invalid/expired/revoked/orphaned session —
       *  never throws, never silently substitutes another identity. */
      const resolveSessionActor = async (token: string): Promise<AuthContext | null> => {
        const tokenHash = hashSessionToken(token);
        const session = await sessionsCol.findOne({ tokenHash });
        if (!session || session.revokedAt) return null;
        if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
        const membership = await memberships.findOne({ userId: session.userId, tenantId: session.tenantId });
        if (!membership) return null; // fail closed: no membership, no context
        void sessionsCol.updateOne({ sessionId: session.sessionId }, { $set: { lastSeenAt: nowIso() } }).catch(() => undefined);
        return {
          actorId: session.userId,
          actorType: 'human_user',
          primaryUserId: session.userId,
          activeTenantId: session.tenantId,
          roles: membership.roles,
          permissions: [],
          scopes: ['global', 'tenant', 'user'],
          isOwner: membership.roles.includes('owner'),
          sessionId: session.sessionId,
        };
      };

      // A session token, if declared, is the ONLY identity signal trusted for
      // that request (see declaredRole/resolveAuth above) — resolved once per
      // request, BEFORE any route handler runs, so guard()/declaredRole()
      // (called from every one of the 10+ route modules) stay synchronous.
      app.addHook('onRequest', async (req) => {
        const raw = req.headers[SESSION_TOKEN_HEADER];
        const token = Array.isArray(raw) ? raw[0] : raw;
        if (!token) return;
        const actor = await resolveSessionActor(token);
        (req as { sessionActor?: AuthContext | null }).sessionActor = actor;
      });

      /** Owner-only privileged provisioning (gated in routes/auth.ts). A
       *  deliberate CROSS-USER write — scopedCollection(ctx) cannot do this
       *  by design (it only ever writes the CALLER's own identity) — so this
       *  is a purpose-built raw-handle function, same category as
       *  buildEsanSeed()'s bootstrap below. Never accepts a plaintext
       *  password itself: routes/auth.ts hashes it (or the caller already
       *  supplied a hash) before calling this. */
      const provisionUser = async (input: { email: string; passwordHash: string; tenantId?: string; tenantName?: string; roles?: string[]; displayName?: string }): Promise<UserAccount> => {
        const now = nowIso();
        const userId = genId('user');
        let tenantId = input.tenantId;
        if (!tenantId) {
          tenantId = genId('tenant');
          await tenantsCol.insertOne({ tenantId, name: input.tenantName || `${input.email} — Personal`, kind: 'personal', status: 'active', settings: {}, createdBy: userId, createdAt: now, updatedAt: now });
        }
        const roles = input.roles && input.roles.length > 0 ? input.roles : (input.tenantId ? ['viewer'] : ['owner', 'tenant_admin']);
        const email = input.email.trim().toLowerCase();
        const account: UserAccount = { userId, email, passwordHash: input.passwordHash, primaryTenantId: tenantId, status: 'active', createdAt: now, updatedAt: now };
        await userAccounts.insertOne(account);
        await memberships.insertOne({ scope: 'tenant', membershipId: genId('membership'), tenantId, userId, roles, status: 'active', createdAt: now, updatedAt: now });
        await userProfiles.insertOne({ scope: 'user', userId, displayName: input.displayName || email.split('@')[0] || email, email, actorType: 'human_user', defaultTenantId: tenantId, locale: 'en', timezone: 'UTC', preferences: {}, status: 'active', createdAt: now, updatedAt: now });
        return account;
      };

      // Idempotent bootstrap: Esan is the first owner and platform governor.
      void (async () => {
        const seed = buildEsanSeed();
        const seeded = await tenantsCol.updateOne({ tenantId: seed.tenant.tenantId }, { $setOnInsert: seed.tenant }, { upsert: true });
        await userProfiles.updateOne({ userId: seed.user.userId }, { $setOnInsert: seed.user }, { upsert: true });
        await memberships.updateOne({ membershipId: seed.membership.membershipId }, { $setOnInsert: seed.membership }, { upsert: true });
        // K1 Real Auth (D-164) — mandatory correction: NEVER generate or print
        // a plaintext password here. If no password hash is configured, log a
        // clear one-time warning with exact setup instructions and leave
        // user_accounts unseeded — login simply stays unavailable (fails
        // closed) until the operator configures a real credential.
        if (!(await userAccounts.findOne({ userId: seed.user.userId }))) {
          const configuredHash = env.FACTORY_OWNER_PASSWORD_HASH.trim();
          if (/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/i.test(configuredHash)) {
            await userAccounts.insertOne({ userId: seed.user.userId, email: env.FACTORY_OWNER_EMAIL.trim().toLowerCase(), passwordHash: configuredHash, primaryTenantId: seed.tenant.tenantId, status: 'active', createdAt: nowIso(), updatedAt: nowIso() });
          } else {
            ctx.log.warn(
              '[K1 Real Auth] FACTORY_OWNER_PASSWORD_HASH is not configured — the owner user_account was NOT seeded, ' +
              'so POST /v1/auth/login has no credential to authenticate against yet. This is intentional: the system ' +
              'never generates or prints a plaintext password. To enable real session login, run ' +
              "`node scripts/hash-password.mjs '<your-password>'`, set FACTORY_OWNER_PASSWORD_HASH to its output " +
              '(and, optionally, FACTORY_OWNER_EMAIL) in the gateway-api environment, then restart. Until then, the ' +
              'legacy x-factory-admin-token + x-factory-role path remains available for human access — see ' +
              'FACTORY_ALLOW_LEGACY_ROLE_AUTH in docs/security-and-permissions.md.'
            );
          }
        }
        if (seeded.upsertedCount > 0) await ctx.publisher.publish({ type: EVENT_TYPES.IDENTITY_SEEDED, taskId: null, payload: { tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, message: 'Esan seeded as owner and platform governor' } });
      })().catch(() => undefined);

      const realityProfiles = collection<PersonalRealityProfile>(COLLECTIONS.PERSONAL_REALITY_PROFILES);
      const personalAssets = collection<PersonalAsset>(COLLECTIONS.PERSONAL_ASSETS);
      const personalProjects = collection<PersonalProject>(COLLECTIONS.PERSONAL_PROJECTS);
      const personalSystems = collection<PersonalSystem>(COLLECTIONS.PERSONAL_SYSTEMS);
      const personalRisks = collection<PersonalRisk>(COLLECTIONS.PERSONAL_RISKS);
      const personalOpportunities = collection<PersonalOpportunity>(COLLECTIONS.PERSONAL_OPPORTUNITIES);
      const personalIncomeStreams = collection<PersonalIncomeStream>(COLLECTIONS.PERSONAL_INCOME_STREAMS);
      const personalCareerRecords = collection<PersonalCareerRecord>(COLLECTIONS.PERSONAL_CAREER_RECORDS);
      const resumeProfiles = collection<ResumeProfile>(COLLECTIONS.RESUME_PROFILES);
      const nextBestActions = collection<NextBestAction>(COLLECTIONS.NEXT_BEST_ACTIONS);
      // personal_health_states/life_items/finance_items/learning_tracks
      // deliberately have no raw handle here — K1.4c (D-159) moved them to
      // scopedCollection(ctx), built per-request in routes/personal.ts.
      const personalBriefingRuns = collection<PersonalBriefingRun>(COLLECTIONS.PERSONAL_BRIEFING_RUNS);
      const strategyReviewRuns = collection<StrategyReviewRun>(COLLECTIONS.STRATEGY_REVIEW_RUNS);

      /** Load the FULL scoped graph input for an actor — the single read path
       *  every personal engine uses. Strictly filtered by userId. */
      const loadGraphInput = async (actor: AuthContext): Promise<PersonalGraphInput> => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [profile, goals, projects, assets, systems, risks, opps, incomes, apprCount, consents] = await Promise.all([
          realityProfiles.findOne(uFilter, { projection: { _id: 0 } }),
          userGoals.find({ ...uFilter, status: 'active' }, { projection: { _id: 0 } }).limit(50).toArray(),
          personalProjects.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray(),
          personalAssets.find(uFilter, { projection: { _id: 0 } }).limit(100).toArray(),
          personalSystems.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray(),
          personalRisks.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray(),
          personalOpportunities.find(uFilter, { projection: { _id: 0 } }).limit(100).toArray(),
          personalIncomeStreams.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray(),
          approvals.countDocuments({ status: 'pending' }),
          consentGrants.find({ userId: uid, status: 'active' }, { projection: { _id: 0 } }).toArray(),
        ]);
        return {
          profile, projects, assets, systems, risks, opportunities: opps, incomeStreams: incomes,
          goals: goals.map((g) => ({ goalId: g.goalId, title: g.title, status: g.status, priority: g.priority })),
          pendingApprovals: apprCount, activeConsents: consents.map((c) => c.connectorType),
        };
      };
      const userStamp = (actor: AuthContext) => stampScope(actor, 'user') as Parameters<typeof scoreNextActions>[1];
      const opTools = collection<OperatorTool>(COLLECTIONS.OPERATOR_TOOLS);
      const opToolRuns = collection<OperatorToolRun>(COLLECTIONS.OPERATOR_TOOL_RUNS);
      const opPermissions = collection<OperatorToolPermission>(COLLECTIONS.OPERATOR_TOOL_PERMISSIONS);
      const opSessions = collection<OperatorRuntimeSession>(COLLECTIONS.OPERATOR_RUNTIME_SESSIONS);
      const opSteps = collection<OperatorRuntimeStep>(COLLECTIONS.OPERATOR_RUNTIME_STEPS);
      const opMemories = collection<OperatorRuntimeMemory>(COLLECTIONS.OPERATOR_RUNTIME_MEMORIES);

      // --- code-operator-agent proxy + capability probing (cached 60s) ---
      const codeAgentTask = async (action: string, input: Record<string, unknown> = {}, timeoutMs = 20000): Promise<{ ok: boolean; summary: string; data?: unknown }> => {
        try {
          const r = await fetch(`${peerUrl('code-operator-agent')}/.factory/task`, {
            method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
            body: JSON.stringify({ goal: `operator:${action}`, input: { action, ...input } }), signal: AbortSignal.timeout(timeoutMs),
          });
          const body = (await r.json()) as { data?: { result?: { ok?: boolean; summary?: string; data?: unknown } } };
          const res = body.data?.result;
          if (!res) return { ok: false, summary: 'code-operator-agent returned no result' };
          return { ok: Boolean(res.ok), summary: res.summary ?? '', data: res.data };
        } catch (e) {
          return { ok: false, summary: `code-operator-agent unreachable: ${e instanceof Error ? e.message : 'error'}` };
        }
      };
      // Phase AG follow-through — real synchronous research dispatch shared by
      // find_opportunities (DB-empty fallback) and research_topic (direct
      // ask). Calls internet-research-service's /.factory/task and AWAITS
      // the real runResearch() result (Tavily when TAVILY_API_KEY is set on
      // THAT service; honest LLM-recall/curated fallback when it isn't) —
      // no fire-and-forget kernel task, so sourceMode/provider/sources land
      // in this same reply instead of a separate async report.
      // Phase AG.1 follow-up — network I/O (the fetch itself) stays here;
      // interpreting the raw fetch failure / HTTP response into a specific
      // outcome (service_unreachable vs service_error vs empty_result vs
      // provider_not_configured vs real search_api) is delegated to pure,
      // unit-testable helpers in shared/src/research (see decision-log D-140).
      const dispatchResearch = async (topic: string): Promise<{ ok: boolean; summary: string; data?: unknown }> => {
        const svc = await ctx.registry.resolve('internet-research-service');
        // Phase AG.4 — svc?.domain is the service's SELF-REGISTERED manifest
        // domain, which is hardcoded to its PRODUCTION subdomain regardless
        // of environment (see internet-research-service/src/factory/
        // manifest.ts). Once the service actually starts locally and
        // registers with a reachable local service-registry (true only
        // since Phase AG.2 added it to LOCAL_SERVICES), naively preferring
        // that domain over peerUrl()'s localhost default made gateway-api
        // silently fetch a real, unrelated production host — reachable, but
        // not this service, which is exactly what produced "internet-
        // research-service returned 404: unknown error". resolvePeerUrl()
        // lets an explicit INTERNET_RESEARCH_SERVICE_URL env override (set
        // for local dev in scripts/local-services.mjs, same mechanism
        // already used for ORCHESTRATOR_AGENT_URL) win over the registry
        // domain, while leaving production (no override set) unchanged.
        const url = resolvePeerUrl('internet-research-service', svc?.domain);
        const taskUrl = `${url}/.factory/task`;
        let r: Response;
        try {
          r = await fetch(taskUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
            body: JSON.stringify({ taskId: genId('task'), goal: topic, input: { topic } }),
            signal: AbortSignal.timeout(45000),
          });
        } catch (e) {
          return classifyResearchFetchFailure(url, e instanceof Error ? e.message : 'request failed');
        }
        // Phase AG.4 — read the raw text first so a non-JSON body (e.g. an
        // HTML 404 page from a misrouted host) is still visible in the
        // error summary instead of silently collapsing to "unknown error".
        const rawText = await r.text().catch(() => '');
        let body: Parameters<typeof interpretResearchTaskResponse>[2] = {};
        try { body = rawText ? JSON.parse(rawText) : {}; } catch { /* non-JSON — surfaced via rawBodySnippet below */ }
        return interpretResearchTaskResponse(r.status, r.ok, body, { url: taskUrl, method: 'POST', rawBodySnippet: rawText });
      };
      let codeWorkspaceProbe: { at: number; configured: boolean } = { at: 0, configured: false };
      const codeWorkspaceConfigured = async (): Promise<boolean> => {
        if (Date.now() - codeWorkspaceProbe.at < 60000) return codeWorkspaceProbe.configured;
        const r = await codeAgentTask('status', {}, 5000);
        const configured = Boolean(r.ok && (r.data as { workspaceConfigured?: boolean } | undefined)?.workspaceConfigured);
        codeWorkspaceProbe = { at: Date.now(), configured };
        return configured;
      };

      const liveRegistry = async (): Promise<OperatorTool[]> => {
        const tools = buildOperatorToolRegistry({
          dokployConfigured: Boolean(dokployClient),
          codeWorkspaceConfigured: await codeWorkspaceConfigured(),
          githubConfigured: Boolean(process.env.GITHUB_TOKEN),
          voiceConfigured: true,
        });
        // Persist the current registry snapshot (idempotent upsert by toolId).
        for (const t of tools) await opTools.updateOne({ toolId: t.toolId }, { $set: { ...t, updatedAt: nowIso() } }, { upsert: true });
        return tools;
      };

      // --- tool executors: every entry is a REAL code path ----------------
      type ExecResult = { ok: boolean; summary: string; data?: unknown; evidenceIds?: string[] };
      const execHealthCheck = async (targetService: string): Promise<ExecResult> => {
        const plan = buildOperationPlan({ goal: `Health check ${targetService}`.trim(), operationType: 'health_check_only', target: { targetService, targetDomain: targetService ? `${targetService}.simorx.com` : '' } });
        plan.status = 'verifying'; await saveOp(plan);
        const v = await runVerification(plan); plan.verification = v;
        const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: targetService || null, summary: `Operator health check: ${v.detail}`, data: { ...v, operationPlanId: plan.operationPlanId } });
        await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId);
        plan.steps = setStep(plan.steps, 'health', v.healthOk ? 'done' : 'failed', v.detail, 'operator-runtime', ev.evidenceId);
        plan.steps = setStep(plan.steps, 'completed', v.healthOk === false ? 'failed' : 'done');
        plan.status = v.healthOk === false ? 'failed' : 'completed'; await saveOp(plan);
        return { ok: v.healthOk !== false, summary: `Health check ${plan.status}: ${v.detail}`, evidenceIds: [ev.evidenceId] };
      };
      const execSystemCheck = async (): Promise<ExecResult> => {
        const [taskCount, runningTasks, apprCount, inc, safeNow] = await Promise.all([
          tasks.countDocuments({}), tasks.countDocuments({ status: { $in: ['queued', 'planning', 'in_progress'] } }),
          approvals.countDocuments({ status: 'pending' }), incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(), isSafeMode(),
        ]);
        const openInc = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').length;
        let serviceCount = -1;
        try {
          const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(4000) });
          const body = (await r.json()) as { data?: unknown[] };
          serviceCount = Array.isArray(body.data) ? body.data.length : -1;
        } catch { /* reported as unknown, never faked */ }
        const dokploy = dokployClient ? (dokploySync.lastAt ? `synced ${dokploySync.lastAt}` : 'connected, not yet synced') : 'not configured';
        const summary = `${serviceCount >= 0 ? `${serviceCount} services registered` : 'registry unreachable'}; ${taskCount} tasks (${runningTasks} active); ${apprCount} approvals pending; ${openInc} open incidents; safe mode ${safeNow ? 'ON' : 'off'}; Dokploy ${dokploy}.`;
        const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: null, summary: `Operator system check: ${summary}`, data: { serviceCount, taskCount, runningTasks, pendingApprovals: apprCount, openIncidents: openInc, safeMode: safeNow } });
        await evidenceCol.insertOne(ev);
        return { ok: true, summary: `System check: ${summary}`, data: { serviceCount, taskCount, runningTasks, pendingApprovals: apprCount, openIncidents: openInc, safeMode: safeNow }, evidenceIds: [ev.evidenceId] };
      };
      // --- Phase AD — Jarvis context gathering -----------------------------
      // Pure fact-fetching: every fact here comes from a REAL query (or the
      // existing execSystemCheck for the system-status path, which already
      // writes its own evidence record). Nothing is invented; missing sources
      // are reported not_configured. shared/jarvis only ranks/compacts what
      // it is given — it never fetches or guesses on its own.
      // Phase AF.4 — the four blocks below (safe-mode check, memory facts,
      // system-check-or-counts, personal graph) were previously four
      // sequential `await`s with no data dependency between them — total
      // latency was their SUM. `intentCategory` (the only thing any of them
      // branches on) is already known before this function is called, so
      // none of them needs another block's result first. Running them via
      // Promise.allSettled makes total latency the SLOWEST of the four
      // instead of the sum — a real, measurable latency cut on every turn,
      // not just the tool-executing ones.
      const gatherJarvisFacts = async (authCtx: AuthContext, scopeClass: ReturnType<typeof classifyGoalScope>, intentCategory: string): Promise<JarvisContextFact[]> => {
        const facts: JarvisContextFact[] = [];

        const safeModePromise = isSafeMode().then((safeNow) => ([{ label: 'safe_mode', detail: safeNow ? 'ON — mutations are blocked' : 'off', status: 'known' as const, weight: safeNow ? 9 : 2 }]));

        // Phase AE.1 — ALWAYS retrieve the owner's own stated priority/decision/
        // blocker memory FIRST, regardless of intent category. This is the fix
        // for the root bug found in the real conversation: memory facts were
        // extracted and persisted but never read back into context, so every
        // answer fell back to raw system-health facts. Weights here (20/12/11)
        // are deliberately higher than anything system health can produce below
        // (max ~10) — an explicit stated priority must outrank a routine
        // unhealthy-service warning, never the other way around.
        const memoryPromise = (async (): Promise<JarvisContextFact[]> => {
          const out: JarvisContextFact[] = [];
          try {
            const recentMemFacts = await jarvisMemoryFacts.find({ actorId: authCtx.actorId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray();
            const priorityFact = pickActivePriorityFact(recentMemFacts);
            if (priorityFact) out.push({ label: 'user_priority', detail: priorityFact.content, status: 'known', weight: 20, href: '/me' });
            for (const bf of recentMemFacts.filter((f) => f.kind === 'blocker').slice(0, 3)) {
              out.push({ label: 'user_blocker', detail: bf.content, status: 'known', weight: 12 });
            }
            for (const df of recentMemFacts.filter((f) => f.kind === 'decision' && f.factId !== priorityFact?.factId).slice(0, 2)) {
              out.push({ label: 'user_decision', detail: df.content, status: 'known', weight: 11 });
            }
          } catch { /* memory retrieval is best-effort — a turn never hard-fails on this */ }
          return out;
        })();

        const systemPromise = (async (): Promise<JarvisContextFact[]> => {
          const out: JarvisContextFact[] = [];
          if (intentCategory === 'system_status' || intentCategory === 'general_conversation') {
            const sys = await execSystemCheck();
            const d = sys.data as { pendingApprovals?: number; openIncidents?: number } | undefined;
            out.push({ label: 'system_check', detail: sys.summary, status: 'known', weight: 10, href: '/operations' });
            if (d) {
              out.push({ label: 'pending_approvals', detail: String(d.pendingApprovals ?? 0), status: 'known', weight: (d.pendingApprovals ?? 0) > 0 ? 8 : 1, href: '/approvals' });
              out.push({ label: 'open_incidents', detail: String(d.openIncidents ?? 0), status: 'known', weight: (d.openIncidents ?? 0) > 0 ? 9 : 1, href: '/incidents' });
            }
          } else {
            const [apprCount, incAll] = await Promise.all([
              approvals.countDocuments({ status: 'pending' }),
              incidents.find({}, { projection: { _id: 0 } }).limit(50).toArray(),
            ]);
            const incOpen = incAll.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
            out.push({ label: 'pending_approvals', detail: String(apprCount), status: 'known', weight: apprCount > 0 ? 6 : 1, href: '/approvals' });
            out.push({ label: 'open_incidents', detail: incOpen.length ? incOpen.slice(0, 2).map((i) => i.title).join('; ') : '0', status: 'known', weight: incOpen.length ? 7 : 1, href: '/incidents' });
          }
          return out;
        })();

        const personalPromise = (async (): Promise<JarvisContextFact[]> => {
          const out: JarvisContextFact[] = [];
          if (scopeClass.scope === 'user') {
            try {
              const gi = await loadGraphInput(authCtx);
              const graph = buildPersonalGraph(gi);
              out.push({ label: 'personal_missing_data', detail: graph.missingData.length ? graph.missingData.slice(0, 3).join('; ') : 'nothing critical', status: graph.missingData.length ? 'not_configured' : 'known', weight: graph.missingData.length ? 6 : 2, href: '/me' });
              const ranked = scoreNextActions(gi, userStamp(authCtx));
              const topAction = ranked[0];
              if (topAction) out.push({ label: 'top_next_action', detail: `${topAction.title} — ${topAction.reason}`, status: 'known', weight: 9, href: '/me' });
              out.push({ label: 'calendar_connector', detail: gi.activeConsents.includes('calendar') ? 'connected' : 'not_configured', status: gi.activeConsents.includes('calendar') ? 'known' : 'not_configured', weight: 3 });
              out.push({ label: 'email_connector', detail: gi.activeConsents.includes('email') ? 'connected' : 'not_configured', status: gi.activeConsents.includes('email') ? 'known' : 'not_configured', weight: 3 });
            } catch { /* keep going with global facts only — a turn never hard-fails on this */ }
          }
          return out;
        })();

        const results = await Promise.allSettled([safeModePromise, memoryPromise, systemPromise, personalPromise]);
        for (const r of results) if (r.status === 'fulfilled') facts.push(...r.value);

        if (intentCategory === 'meta_self_assessment' || intentCategory === 'general_conversation') {
          facts.push({ label: 'aos_current_phase', detail: AOS_SELF_KNOWLEDGE.currentPhase, status: 'known', weight: 5 });
          for (const g of AOS_SELF_KNOWLEDGE.knownGaps.slice(0, 4)) facts.push({ label: 'known_gap', detail: g, status: 'known', weight: 5 });
          facts.push({ label: 'highest_leverage_next_step', detail: AOS_SELF_KNOWLEDGE.highestLeverageNextStep, status: 'known', weight: 6 });
        }
        return facts;
      };

      /** Compose the grounded reply, persist the turn (Jarvis's own interaction
       *  memory) and emit an event — shared by the direct-answer path, the
       *  honest clarify-fallback, and the post-session reply for routed goals. */
      const composeAndRecordJarvisTurn = async (args: { text: string; intent: JarvisIntent; authCtx: AuthContext; scopeClass: ReturnType<typeof classifyGoalScope>; mode: 'direct_answer' | 'route_to_planner'; planSummary?: string; forceFallback: boolean }): Promise<{ reply: string; language: string; suggestedFollowUps: string[] }> => {
        const facts = await gatherJarvisFacts(args.authCtx, args.scopeClass, args.intent.category);
        const packet = buildJarvisContextPacket({
          actorName: args.authCtx.primaryUserId === ESAN_USER_ID ? 'Esan' : args.authCtx.actorId,
          isOwner: args.authCtx.isOwner,
          scope: args.scopeClass.scope === 'user' ? 'user' : 'global',
          facts,
        });
        const { data: composed } = await composeJarvisResponse(jarvisRouter, { text: args.text, intent: args.intent, packet, planSummary: args.planSummary, forceFallback: args.forceFallback });

        // Phase AE.1 — correction gate: the packet may carry a real, recent
        // `user_priority` fact (weight 20 — see gatherJarvisFacts), but an
        // LLM-composed reply is only grounded by INSTRUCTION, not by
        // construction, so it can still ignore it (the exact failure a real
        // conversation exposed). The deterministic fallback CANNOT skip a
        // present user_priority fact (see composeJarvisResponseFallback), so
        // it is the correction template — never a second LLM call, never
        // unpredictable.
        let response = composed;
        let corrected = false;
        if (answerIgnoresStatedPriority(composed, packet)) {
          response = composeJarvisResponseFallback({ text: args.text, intent: args.intent, packet, planSummary: args.planSummary });
          corrected = true;
        }

        const turn = buildJarvisTurn({ turnId: genId('jturn'), actorId: args.authCtx.actorId, scope: args.scopeClass.scope === 'user' ? 'user' : 'global', text: args.text, intent: args.intent, mode: args.mode, reply: response.reply, usedFallback: jarvisRouter.activeProvider === 'mock' || args.forceFallback || corrected });
        await jarvisTurns.insertOne(turn);
        await ctx.publisher.publish({ type: EVENT_TYPES.JARVIS_TURN_ANSWERED, taskId: null, payload: { turnId: turn.turnId, category: args.intent.category, language: args.intent.language, message: `Jarvis (${args.intent.category}): ${response.reply.slice(0, 140)}` } });

        // Phase AF.4 — memory extraction was previously `await`ed here despite
        // being commented "best-effort; never blocks the turn" — that comment
        // was only true about correctness (wrapped in try/catch), not about
        // latency: it's a full 3rd sequential LLM call blocking every single
        // reply. The reply the user is waiting on does not depend on this
        // fact ever being written before it's shown, so it now genuinely
        // runs in the background instead of merely failing safely in the
        // foreground. Same for answer scoring (cheap, but no reason to make
        // the user wait on it either).
        void (async () => {
          try {
            const { result: extraction, usedFallback: memUsedFallback } = await extractMemoryFacts(jarvisRouter, args.text, { forceFallback: args.forceFallback, taskId: null });
            if (extraction.facts.length) {
              const memFacts = buildMemoryFacts({ turnId: turn.turnId, actorId: args.authCtx.actorId, scope: args.scopeClass.scope === 'user' ? 'user' : 'global', result: extraction, usedLlm: !memUsedFallback });
              if (memFacts.length) await jarvisMemoryFacts.insertMany(memFacts);
            }
          } catch { /* memory extraction is best-effort; never blocks the reply */ }
          try {
            const score = scoreJarvisAnswer({
              turnId: turn.turnId,
              replyText: response.reply,
              replyLanguage: response.language,
              groundedIn: response.groundedIn ?? [],
              suggestedFollowUpsCount: response.suggestedFollowUps.length,
              intentLanguage: args.intent.language,
              intentCategory: args.intent.category,
              packetLabels: facts.map((f) => f.label),
              packetHasNotConfigured: facts.some((f) => f.status === 'not_configured'),
            });
            await jarvisAnswerScores.insertOne(score);
          } catch { /* scoring is best-effort; never blocks the reply */ }
        })();

        return { reply: response.reply, language: response.language, suggestedFollowUps: response.suggestedFollowUps };
      };

      const writeOpMemory = async (userId: string, kind: OperatorRuntimeMemory['kind'], content: string, sessionId: string | null, toolId: string | null): Promise<string> => {
        const mem: OperatorRuntimeMemory = { memoryId: genId('omem'), userId, kind, content, sourceSessionId: sessionId, sourceToolId: toolId, createdAt: nowIso() };
        await opMemories.insertOne(mem);
        return mem.memoryId;
      };

      type OperatorRole = ReturnType<typeof declaredRole>;
      const execClassifyRisk = async (args: Record<string, unknown>): Promise<ExecResult> => {
        const target = String(args.targetService ?? '');
        const core = isProtectedCore(target);
        const risk = core ? 'critical' : 'high';
        return { ok: true, summary: `${target || 'target'}: ${risk} risk${core ? ' (PROTECTED CORE — owner approval on Overview required)' : ''}.`, data: { riskLevel: risk, protectedCore: core } };
      };
      const execCreateOperationPlan = async (args: Record<string, unknown>): Promise<ExecResult> => {
        const target = String(args.targetService ?? '');
        if (isProtectedCore(target)) return { ok: false, summary: `${target} is protected core — I will not create an auto-executable plan. Use the Overview owner flow.` };
        if (await isSafeMode()) return { ok: false, summary: 'Safe mode is ON — mutations are blocked.' };
        const plan = buildOperationPlan({ goal: String(args.goal ?? `Operation on ${target}`), operationType: (String(args.operationType ?? 'existing_app_restart') as 'existing_app_restart'), target: { targetService: target } });
        await saveOp(plan);
        return { ok: true, summary: `Operation plan ${plan.operationPlanId} created (${plan.riskLevel} risk). Approve and execute it on the Overview.`, data: { operationPlanId: plan.operationPlanId, riskLevel: plan.riskLevel } };
      };
      const executors: Record<string, (args: Record<string, unknown>, role: OperatorRole) => Promise<ExecResult>> = {
        get_system_status: async () => {
          const [taskCount, apprCount] = await Promise.all([tasks.countDocuments({}), approvals.countDocuments({ status: 'pending' })]);
          return { ok: true, summary: `${taskCount} tasks in the kernel, ${apprCount} approvals pending.`, data: { taskCount, pendingApprovals: apprCount } };
        },
        get_readiness: async () => {
          const [safeNow, op] = await Promise.all([isSafeMode(), operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray()]);
          const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
          const summary = `Safe mode ${safeNow ? 'ON' : 'off'}; Dokploy ${dokployClient ? 'configured' : 'not configured'}; ${activeOp ? `active operation “${activeOp.goal}” (${activeOp.status})` : 'no active operation'}.`;
          return { ok: true, summary, data: { safeMode: safeNow, dokployConfigured: Boolean(dokployClient), activeOperation: activeOp?.operationPlanId ?? null } };
        },
        get_service_registry: async () => {
          try {
            const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(5000) });
            const body = (await r.json()) as { data?: Array<{ serviceId?: string }> };
            const list = Array.isArray(body.data) ? body.data : [];
            return { ok: true, summary: `${list.length} services registered.`, data: list.slice(0, 30) };
          } catch { return { ok: false, summary: 'Service registry unreachable.' }; }
        },
        get_recent_events: async () => {
          const list = await events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray();
          return { ok: true, summary: `${list.length} recent events; latest: ${(list[0]?.payload as { message?: string })?.message ?? list[0]?.type ?? 'none'}.`, data: list };
        },
        get_recent_errors: async () => {
          const inc = await incidents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray();
          const open = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
          return { ok: true, summary: open.length === 0 ? 'No open incidents.' : `${open.length} open incidents; latest: ${open[0]?.title ?? open[0]?.incidentId}.`, data: open.slice(0, 10) };
        },
        get_pending_approvals: async () => {
          const list = await approvals.find({ status: 'pending' }, { projection: { _id: 0 } }).limit(10).toArray();
          return { ok: true, summary: list.length === 0 ? 'No approvals waiting.' : `${list.length} approvals waiting for a decision.`, data: list };
        },
        get_active_operations: async () => {
          const list = await operationPlans.find({ status: { $nin: ['completed', 'failed', 'rolled_back', 'cancelled'] } }, { projection: { _id: 0 } }).limit(10).toArray();
          return { ok: true, summary: list.length === 0 ? 'No operations in flight.' : `${list.length} operation(s) in flight: ${list.map((p) => `“${p.goal}” (${p.status})`).join('; ')}.`, data: list };
        },
        check_service_health: async (args) => execHealthCheck(String(args.targetService ?? '')),
        run_system_status_check: async () => execSystemCheck(),
        show_evidence: async () => {
          const list = await evidence.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray();
          return { ok: true, summary: `${list.length} recent evidence records.`, data: list };
        },
        get_latest_report: async () => {
          const list = await intelligenceReports.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray();
          return { ok: true, summary: list[0] ? `Latest report: “${list[0].title}”.` : 'No intelligence reports yet.', data: list };
        },
        get_task: async (args) => {
          const t = await tasks.findOne({ taskId: String(args.taskId ?? '') }, { projection: { _id: 0 } });
          return t ? { ok: true, summary: `Task ${t.taskId}: ${t.status} — ${t.goal.slice(0, 80)}`, data: t } : { ok: false, summary: 'Task not found.' };
        },
        summarize_task: async (args) => {
          const t = await tasks.findOne({ taskId: String(args.taskId ?? '') }, { projection: { _id: 0 } });
          return t ? { ok: true, summary: `“${t.goal.slice(0, 60)}” is ${t.status}${t.assignedServiceId ? ` with ${t.assignedServiceId}` : ''}.` } : { ok: false, summary: 'Task not found.' };
        },
        classify_operation_risk: async (args) => execClassifyRisk(args),
        explain_risk: async (args) => execClassifyRisk(args),
        create_operation_plan: async (args) => execCreateOperationPlan(args),
        verify_operation: async (args) => {
          const plan = await operationPlans.findOne({ operationPlanId: String(args.operationPlanId ?? '') });
          if (!plan) return { ok: false, summary: 'Operation plan not found.' };
          const v = await runVerification(plan);
          return { ok: v.healthOk !== false, summary: `Verification: ${v.detail}`, data: v };
        },
        approve_operation: async () => ({ ok: true, summary: 'Owner approval happens on the Overview — the approval card is visible there. I never approve silently.' }),
        execute_operation: async () => ({ ok: true, summary: 'Execution of an approved operation runs from the Overview console (API or guided manual), with snapshot and verification.' }),
        rollback_operation: async () => ({ ok: true, summary: 'Rollback runs from the Overview console using the stored snapshot (owner action).' }),
        test_dokploy_connection: async () => {
          if (!dokployClient) return { ok: false, summary: 'Dokploy API not configured.' };
          const c = await dokployClient.testConnection();
          return { ok: c.ok, summary: c.ok ? 'Dokploy API reachable.' : `Dokploy connection failed: ${c.error ?? 'unknown'}` };
        },
        sync_dokploy_targets: async () => {
          if (!dokployClient) return { ok: false, summary: 'Dokploy API not configured — manual target confirmation remains available.' };
          const pr = await dokployClient.listProjects();
          if (!pr.ok) return { ok: false, summary: `Dokploy sync failed: ${pr.error}` };
          dokploySync.lastAt = nowIso();
          return { ok: true, summary: `Synced ${parseDokployTargets(pr.data).length} Dokploy targets.` };
        },
        list_dokploy_targets: async () => {
          const list = await collection<Record<string, unknown>>(COLLECTIONS.DOKPLOY_TARGETS).find({}, { projection: { _id: 0 } }).limit(30).toArray();
          return { ok: true, summary: `${list.length} Dokploy targets known.`, data: list };
        },
        run_dokploy_diagnostics: async () => {
          if (!dokployClient) return { ok: false, summary: 'Dokploy API not configured.' };
          const d = await buildDiagnostics(dokployClient, '');
          return { ok: true, summary: `Diagnostics: ${d.length} endpoints probed (secrets redacted).`, data: d.map((x) => ({ endpoint: (x as { endpoint?: string }).endpoint, supported: (x as { supported?: boolean }).supported })) };
        },
        restart_dokploy_app: async (args) => execCreateOperationPlan({ goal: `Restart ${args.targetService}`, operationType: 'existing_app_restart', targetService: args.targetService }),
        deploy_dokploy_app: async (args) => execCreateOperationPlan({ goal: `Deploy ${args.targetService}`, operationType: 'existing_app_update', targetService: args.targetService }),
        read_dokploy_logs: async () => ({ ok: true, summary: 'Container logs: open the app in the Dokploy UI — the log read endpoint is not calibrated on this instance yet (manual path).' }),
        // Code tools → code-operator-agent (workspace + branch isolation there).
        inspect_repo: async (args) => codeAgentTask('inspect_repo', args),
        search_code: async (args) => codeAgentTask('search_code', args),
        propose_code_change: async (args) => codeAgentTask('propose_code_change', args),
        edit_code: async (args) => codeAgentTask('edit_code', args, 30000),
        run_typecheck: async (args) => codeAgentTask('run_typecheck', args, 120000),
        build_package: async (args) => codeAgentTask('build_package', args, 300000),
        run_smoke_tests: async (args) => codeAgentTask('run_smoke_tests', args, 120000),
        create_git_branch: async (args) => codeAgentTask('create_git_branch', args),
        commit_changes: async (args) => codeAgentTask('commit_changes', args),
        create_pr: async (args) => codeAgentTask('create_pr', args, 30000),
        // Kernel task pipelines (real agents).
        create_task: async (args) => { const id = await createKernelTask(String(args.goal ?? 'Operator task'), ['operator']); return { ok: true, summary: `Task ${id} started.`, data: { taskId: id } }; },
        create_new_service: async (args) => { const id = await createKernelTask(String(args.goal ?? 'Create a new service'), ['service-creation', 'operator']); return { ok: true, summary: `Service-creation task ${id} started (architect → builder → validation).`, data: { taskId: id } }; },
        // Phase AG follow-through — was a fire-and-forget kernel task that
        // only ever replied "Research task started"; now calls the real
        // research fabric synchronously and returns grounded findings +
        // sourceMode in this same turn.
        research_topic: async (args) => dispatchResearch(String(args.goal ?? 'current best practices').slice(0, 300)),
        analyze_history: async () => { const id = await createKernelTask('Analyze system history and recommend improvements', ['learning', 'operator']); return { ok: true, summary: `Learning analysis task ${id} started.`, data: { taskId: id } }; },
        generate_report: async () => { const id = await createKernelTask('Generate an executive system report.', ['report', 'operator']); return { ok: true, summary: `Report task ${id} started.`, data: { taskId: id } }; },
        run_security_check: async (_args, role) => {
          const audit = auditEnvironment(envAuditInput());
          const check = buildSecurityCheck('system', audit, await isSafeMode());
          await securityChecks.insertOne(check);
          await writeAudit({ actorType: 'human', actorId: role, role, action: 'security_check_run', targetType: 'security_check', targetId: check.checkId, after: { passed: check.passed, riskLevel: check.riskLevel } });
          return { ok: check.passed, summary: `Security check ${check.passed ? 'passed' : 'found issues'} (${check.riskLevel}).`, data: { checkId: check.checkId, passed: check.passed } };
        },
        recommend_improvements: async () => {
          const list = await collection<Record<string, unknown>>(COLLECTIONS.SYSTEM_RECOMMENDATIONS).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(5).toArray();
          return { ok: true, summary: list.length === 0 ? 'No open recommendations.' : `${list.length} recommendations available.`, data: list };
        },
        validate_service: async (args) => {
          const list = await collection<Record<string, unknown>>(COLLECTIONS.DEPLOYMENT_CHECKLISTS).find({ serviceId: String(args.serviceId ?? '') }, { projection: { _id: 0 } }).limit(3).toArray();
          return { ok: true, summary: list.length === 0 ? 'No activation checklist for that service yet.' : `Checklist found — run activation from the Deployment page.`, data: list };
        },
        activate_service: async () => ({ ok: true, summary: 'Live activation runs from the Deployment page checklist (real HTTP checks, evidence stored).' }),
        repair_service: async (args) => ({ ok: true, summary: `Repair goes through diagnose → plan → approval on Incidents. ${args.serviceId ? `Target: ${args.serviceId}.` : ''}` }),
        read_relevant_memory: async () => {
          const list = await opMemories.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray();
          return { ok: true, summary: list.length === 0 ? 'No operator memories yet.' : `${list.length} memories loaded.`, data: list };
        },
        write_memory: async (args, role) => { const id = await writeOpMemory(role, (String(args.kind ?? 'decision') as OperatorRuntimeMemory['kind']), String(args.content ?? ''), null, null); return { ok: true, summary: 'Memory written.', data: { memoryId: id } }; },
        write_mistake_memory: async (args, role) => { const id = await writeOpMemory(role, 'mistake_avoidance', String(args.content ?? ''), null, null); return { ok: true, summary: 'Mistake memory written.', data: { memoryId: id } }; },
        update_user_preference: async (args, role) => { const id = await writeOpMemory(role, 'preference', String(args.content ?? ''), null, null); return { ok: true, summary: 'Preference saved.', data: { memoryId: id } }; },
        // Phase Y — staging workspace & service evolution (code-operator-agent).
        create_workspace: async (args) => codeAgentTask('ws_create', args, 90000),
        copy_service_to_workspace: async (args) => codeAgentTask('ws_create', { ...args, mode: args.mode ?? 'evolve_existing_service' }, 90000),
        create_new_service_workspace: async (args) => codeAgentTask('ws_create', { ...args, mode: 'create_new_service' }, 60000),
        inspect_workspace: async (args) => codeAgentTask('ws_inspect', args, 20000),
        edit_workspace: async (args) => codeAgentTask('ws_edit', args, 60000),
        run_workspace_typecheck: async (args) => codeAgentTask('ws_typecheck', args, 200000),
        run_workspace_build: async (args) => codeAgentTask('ws_build', args, 440000),
        run_workspace_tests: async (args) => codeAgentTask('ws_iterate', args, 620000),
        start_workspace_service: async (args) => codeAgentTask('ws_run', args, 130000),
        verify_workspace_service: async (args) => codeAgentTask('ws_verify', args, 620000),
        create_migration_plan: async (args) => codeAgentTask('ws_migration_plan', args, 30000),
        approve_migration: async (args, role) => codeAgentTask('ws_approve_migration', { ...args, decision: args.decision ?? 'approve', decidedBy: role }, 20000),
        deploy_staged_workspace: async (args) => execCreateOperationPlan({ goal: `Deploy STAGED app ${args.appName ?? ''} (workspace result; verify /health before promotion)`, operationType: 'new_app_deploy', targetService: String(args.appName ?? '') }),
        promote_workspace: async (args, role) => codeAgentTask('ws_promote', { ...args, approvedForProtectedCore: role === 'owner' }, 120000),
        rollback_workspace: async (args) => codeAgentTask('ws_rollback', args, 60000),
        // Phase AA — personal operating layer executors (user scope, honest).
        get_my_context: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity for this actor — user scope fails closed.' };
          const [profile, goals, consents] = await Promise.all([
            userProfiles.findOne({ userId: actor.primaryUserId }, { projection: { _id: 0 } }),
            userGoals.find({ scope: 'user', userId: actor.primaryUserId, status: 'active' }, { projection: { _id: 0 } }).limit(20).toArray(),
            consentGrants.find({ userId: actor.primaryUserId, status: 'active' }, { projection: { _id: 0 } }).toArray(),
          ]);
          const name = profile?.displayName ?? 'You';
          const consentList = consents.length ? consents.map((c) => c.connectorType).join(', ') : 'none';
          const summary = goals.length === 0
            ? `${name}: ${consents.length} source(s) connected (${consentList}) — no active goals yet.`
            : `${name}: ${goals.length} active goal(s)${goals[0] ? ` — top: “${goals[0].title}”` : ''}; ${consents.length} source(s) (${consentList}).`;
          return { ok: true, summary, data: { profile, goals, consents: consents.map((c) => ({ connectorType: c.connectorType, accessMode: c.accessMode })) } };
        },
        generate_daily_briefing: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const goals = await userGoals.find({ scope: 'user', userId: actor.primaryUserId, status: 'active' }, { projection: { _id: 0 } }).limit(20).toArray();
          const activeConsents = await consentGrants.find({ userId: actor.primaryUserId, status: 'active' }, { projection: { _id: 0 } }).toArray();
          const consentedTypes = new Set(activeConsents.map((c) => c.connectorType));
          const missing = ['calendar', 'email', 'tasks'].filter((s) => !consentedTypes.has(s)).map((s) => `${s} (not_configured — no consent grant)`);
          const summary = goals.length === 0
            ? `No active goals recorded yet — add goals via /v1/me/goals or the Identity settings. Data sources available: ${consentedTypes.size ? [...consentedTypes].join(', ') : 'none'}. Missing: ${missing.join(', ') || 'none'}.`
            : `Your ${goals.length} active goal(s): ${goals.map((g) => `“${g.title}” (${g.horizon}, ${g.priority})`).join('; ')}. This briefing uses ONLY your recorded goals — ${missing.length ? `these sources are not configured: ${missing.join(', ')}` : 'all core sources connected'}.`;
          const stamp = stampScope(actor, 'user');
          const briefing: DailyBriefing = { ...stamp, briefingId: genId('brief'), date: nowIso().slice(0, 10), summary, sourcesUsed: ['user_goals', ...[...consentedTypes]], missingSources: missing, createdAt: nowIso() };
          await dailyBriefings.insertOne(briefing);
          return { ok: true, summary, data: { briefingId: briefing.briefingId, missingSources: missing } };
        },
        // Phase AB — Jarvis personal intelligence executors (strict user scope).
        build_reality_baseline: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const input = await loadGraphInput(actor);
          const graph = buildPersonalGraph(input);
          const summary = `Baseline: ${input.profile ? `profile “${input.profile.displayName || input.profile.headline || 'set'}”` : 'NO profile yet'}; ${input.goals.length} goals, ${input.projects.length} projects, ${input.assets.length} assets, ${input.systems.length} systems, ${input.risks.length} risks, ${input.opportunities.length} opportunities, ${input.incomeStreams.length} income streams. Missing: ${graph.missingData.length ? graph.missingData.slice(0, 3).join('; ') : 'nothing critical'}. Freshness: ${graph.dataFreshness.slice(0, 10)}.`;
          return { ok: true, summary, data: { graphNodes: graph.nodes.length, graphEdges: graph.edges.length, missingData: graph.missingData } };
        },
        capture_personal_goal: async (args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const title = String(args.title ?? '').trim().slice(0, 160);
          if (!title) return { ok: false, summary: 'Goal title is required. Say: "My goal is ..."' };
          const stamp = stampScope(actor, 'user');
          const goal: UserGoal = {
            ...stamp,
            goalId: genId('goal'),
            title,
            description: String(args.description ?? '').trim().slice(0, 1000),
            horizon: (['day', 'week', 'month', 'quarter', 'year', 'life'].includes(String(args.horizon)) ? String(args.horizon) : 'week') as UserGoal['horizon'],
            status: 'active',
            priority: (['low', 'normal', 'high'].includes(String(args.priority)) ? String(args.priority) : 'normal') as UserGoal['priority'],
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          await userGoals.insertOne(goal);
          return { ok: true, summary: `Saved your goal: “${goal.title}” (${goal.horizon}, ${goal.priority}).` };
        },
        capture_reality_profile: async (args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const stamp = stampScope(actor, 'user');
          const now = nowIso();
          const headline = String(args.headline ?? '').trim().slice(0, 180);
          const currentPosition = String(args.currentPosition ?? '').trim().slice(0, 140);
          const focusArea = String(args.focusArea ?? '').trim().slice(0, 120);
          if (!headline && !currentPosition && !focusArea) {
            return { ok: false, summary: 'No profile details detected. Try: “My role is ..., my focus is ...”.' };
          }
          const existing = await realityProfiles.findOne({ scope: 'user', userId: actor.primaryUserId });
          if (existing) {
            await realityProfiles.updateOne(
              { profileId: existing.profileId },
              {
                $set: {
                  ...(headline ? { headline } : {}),
                  ...(currentPosition ? { currentPosition } : {}),
                  ...(focusArea ? { focusAreas: [focusArea] } : {}),
                  updatedAt: now,
                  freshness: now,
                  source: 'operator_capture',
                  confidence: 1,
                  recordKind: 'fact',
                },
              },
            );
          } else {
            await realityProfiles.insertOne({
              ...stamp,
              profileId: genId('pprof'),
              displayName: '',
              headline: headline || currentPosition || 'Personal profile',
              summary: '',
              location: '',
              focusAreas: focusArea ? [focusArea] : [],
              strengths: [],
              currentPosition: currentPosition || '',
              incomeDirection: '',
              scheduleDirection: '',
              learningDirection: '',
              source: 'operator_capture',
              confidence: 1,
              freshness: now,
              recordKind: 'fact',
              createdAt: now,
              updatedAt: now,
            } as PersonalRealityProfile);
          }
          return { ok: true, summary: 'Saved profile context. I will use it in your next recommendations.' };
        },
        get_next_best_actions: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const input = await loadGraphInput(actor);
          const graph = buildPersonalGraph(input);
          const ranked = scoreNextActions(input, userStamp(actor));
          if (ranked.length === 0) {
            return {
              ok: true,
              summary:
                `Current snapshot: goals ${input.goals.length}, consented sources ${input.activeConsents.length}, profile ${input.profile ? 'ready' : 'missing'}. ` +
                `I cannot rank a useful next step yet. Question: what is your single most important goal for the next 7 days? ` +
                `Reply in one sentence: "My goal is ...".`,
            };
          }
          await nextBestActions.insertMany(ranked.slice(0, 5).map((a) => ({ ...a })));
          const missing = graph.missingData.length;
          const best = ranked[0];
          const askGoal = input.goals.length === 0;
          const askProfile = !input.profile;
          const askConsent = input.activeConsents.length === 0;
          const guidedBest = askGoal
            ? 'Define one clear 7-day goal'
            : askProfile
              ? 'Set a short personal profile (role + focus)'
              : askConsent
                ? 'Connect one read-only source'
                : (best?.title ?? 'Run daily briefing');
          const reason = askGoal
            ? 'Without a concrete goal, recommendations stay generic.'
            : askProfile
              ? 'Your role/focus improves ranking quality.'
              : askConsent
                ? 'One source improves signal quality.'
                : (best?.reason ?? 'Highest scored action.');
          const question = askGoal
            ? 'Question: what is your top goal for the next 7 days?'
            : askProfile
              ? 'Question: what is your current role and main focus right now?'
              : askConsent
                ? 'Question: which source should I connect first (calendar/email/tasks)?'
                : 'Question: do you want me to run your daily briefing now?';
          return {
            ok: true,
            summary:
              `Snapshot: Goals ${input.goals.length}, Consents ${input.activeConsents.length}${input.activeConsents.length ? ` (${input.activeConsents.join(', ')})` : ''}, Missing areas ${missing}. ` +
              `Best next step: ${guidedBest}. Why: ${reason} ${question}`,
            data: { ranked: ranked.slice(0, 5) },
          };
        },
        run_full_daily_briefing: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const input = await loadGraphInput(actor);
          const sources = { calendar: input.activeConsents.includes('calendar'), email: input.activeConsents.includes('email'), tasksConnector: input.activeConsents.includes('tasks') };
          const graph = buildPersonalGraph(input);
          const aosSuggestion = graph.missingData.length > 0 ? `AOS next build: automated ingestion for “${graph.missingData[0]}”.` : 'AOS next build: read-only calendar connector.';
          const run = buildDailyBriefingRun(input, sources, aosSuggestion, userStamp(actor));
          await personalBriefingRuns.insertOne(run);
          return { ok: true, summary: `Briefing ${run.date}: priorities — ${run.topPriorities.join('; ') || 'none rankable yet'}. Risks: ${run.risks.join('; ') || 'none recorded'}. Income: ${run.incomeAction} Growth: ${run.growthAction} AOS: ${run.aosAction} Approvals pending: ${run.pendingApprovals}. Sources off: ${run.sourcesNotConfigured.join(', ') || 'none'}.`, data: { briefingRunId: run.briefingRunId, missingData: run.missingData } };
        },
        run_weekly_strategy: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const input = await loadGraphInput(actor);
          const [completed, missed, newOpps] = await Promise.all([
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'completed' }),
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'rejected' }),
            personalOpportunities.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'proposed' }),
          ]);
          const run = buildWeeklyStrategyRun({ ...input, completedActions: completed, missedActions: missed, newOpportunities: newOpps }, userStamp(actor));
          await strategyReviewRuns.insertOne(run);
          return { ok: true, summary: `Week of ${run.weekOf}: ${run.goalsReviewed} goals, ${completed} completed / ${missed} rejected actions, ${newOpps} open opportunities. Plan: ${run.weeklyPlan.slice(0, 3).join(' | ')}. AOS should build: ${run.aosShouldBuild[0]}`, data: { strategyRunId: run.strategyRunId } };
        },
        analyze_resume: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const [resume, careers, goals] = await Promise.all([
            resumeProfiles.findOne({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }),
            personalCareerRecords.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
            userGoals.find({ scope: 'user', userId: actor.primaryUserId, status: 'active' }, { projection: { _id: 0 } }).limit(10).toArray(),
          ]);
          if (!resume && careers.length === 0) return { ok: true, summary: 'No resume data in your scope yet. Ingest it first: POST /v1/me/reality/ingest kind=resume (rawText + skills) and kind=career_record. I will not invent credentials.' };
          const analysis = analyzeResume({ rawText: resume?.rawText ?? '', skills: resume?.skills ?? [], careerRecords: careers, goals: goals.map((g) => ({ title: g.title })) });
          if (resume) await resumeProfiles.updateOne({ resumeProfileId: resume.resumeProfileId }, { $set: { ...analysis, updatedAt: nowIso() } });
          return { ok: true, summary: `Positioning: ${analysis.positioning} Facts(verified): ${analysis.verifiedFacts.length}; your claims: ${analysis.userClaims.length}; inferences: ${analysis.modelInferences.length}. Top improvements: ${analysis.suggestions.slice(0, 2).join(' ')}`, data: analysis };
        },
        find_opportunities: async (args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const opps = await personalOpportunities.find({ scope: 'user', userId: actor.primaryUserId, status: { $in: ['proposed', 'accepted', 'in_progress'] } }, { projection: { _id: 0 } }).limit(100).toArray();
          if (opps.length > 0) {
            const ranked = rankOpportunities(opps);
            const top = ranked[0];
            return { ok: true, summary: `Top opportunity: “${top?.title}” (${top?.category}), value ${top?.valueScore} — ${top?.reason.slice(0, 120)} [source: ${top?.source}, confidence ${top?.confidence}]. Next: ${top?.recommendedNextAction || 'define the first concrete step'}. ${ranked.length} ranked in total.`, data: { ranked: ranked.slice(0, 5) } };
          }
          // Phase AG follow-through — this used to be a hardcoded
          // "research provider is not_configured" string regardless of
          // whether Tavily was actually configured. Now it researches the
          // real goal text live via internet-research-service and reports
          // the actual sourceMode; only a genuine dispatch failure falls
          // back to an honest "not available" message.
          const topic = String(args.goal ?? '').trim() || 'high-value income and career opportunities';
          const research = await dispatchResearch(topic);
          if (research.ok) return { ok: true, summary: `No opportunities recorded in your scope yet — researched live instead. ${research.summary}`, data: research.data };
          return { ok: true, summary: `No opportunities recorded in your scope yet, and live research failed: ${research.summary} Ingest opportunity candidates directly (POST /v1/me/reality/ingest), or fix internet-research-service/TAVILY_API_KEY.` };
        },
        propose_aos_build: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const input = await loadGraphInput(actor);
          const graph = buildPersonalGraph(input);
          if (!input.profile || input.goals.length === 0 || input.activeConsents.length === 0) {
            const gaps: string[] = [];
            if (!input.profile) gaps.push('identity/profile');
            if (input.goals.length === 0) gaps.push('at least one active goal');
            if (input.activeConsents.length === 0) gaps.push('one read-only connector consent');
            return {
              ok: true,
              summary:
                `I can propose a higher-quality build after your baseline is complete. Missing now: ${gaps.join(', ')}. ` +
                `Quick path: open /me and fill the intake panel (identity, one goal, one consent, one fact), then run “daily briefing”. ` +
                `If you prefer voice, say: “build my personal reality baseline and then propose the next AOS build”.`,
            };
          }
          const aosOpps = input.opportunities.filter((o) => o.category === 'aos_capability' && o.status === 'proposed');
          const candidates: Array<{ title: string; why: string; impact: number; effort: number }> = [
            ...aosOpps.map((o) => ({ title: o.title, why: o.reason, impact: o.impactScore, effort: o.effortScore })),
            ...(graph.missingData.filter((m) => m.includes('not_configured')).slice(0, 2).map((m) => ({ title: `Read-only connector for ${m.split(':')[0]}`, why: `Closes intelligence gap: ${m}`, impact: 7, effort: 5 }))),
          ];
          if (candidates.length === 0) candidates.push({ title: 'Automated personal-data freshness monitor', why: 'All core data present — the next lever is keeping it fresh automatically.', impact: 5, effort: 3 });
          const best = candidates.sort((a, b) => (b.impact - b.effort) - (a.impact - a.effort))[0];
          return { ok: true, summary: `AOS should build next for you: “${best?.title}”. Why: ${best?.why} (impact ${best?.impact}/10, effort ${best?.effort}/10). Building it is GLOBAL workspace evolution — say “create a ${best?.title.toLowerCase().slice(0, 40)} service” to plan it; nothing deploys without your approval.`, data: { candidates } };
        },
        request_approval: async () => ({ ok: true, summary: 'Approval card created.' }),
        record_decision: async (args, role) => { await writeAudit({ actorType: 'human', actorId: role, role, action: 'operator_decision', targetType: 'operator_runtime', targetId: 'decision', after: { decision: String(args.decision ?? ''), reason: String(args.reason ?? '') } }); return { ok: true, summary: 'Decision recorded in the audit log.' }; },
      };

      /** A step needs a human gate unless it is a low-risk immediate read. */
      const needsGate = (tool: OperatorTool): boolean =>
        tool.requiresApproval || tool.ownerOnly || tool.riskLevel !== 'low' ||
        tool.executionPath === 'kernel_task' || tool.executionPath === 'operation_plan';

      const recordStep = async (session: OperatorRuntimeSession, stepDef: PlanStep, narration: string, observation: string, status: string): Promise<void> => {
        await opSteps.insertOne({ stepRecordId: genId('ostep'), runtimeSessionId: session.runtimeSessionId, stepId: stepDef.stepId, toolId: stepDef.toolId, narration, observation, status, createdAt: nowIso() });
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_STEP_COMPLETED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, toolId: stepDef.toolId, status, message: narration } });
        // Phase AF.4 — previously `opSessions` was only written ONCE, at the
        // very end of a `runLoop` invocation (when it finished, failed, or
        // paused for approval). That was invisible to the client's session
        // poll while several tool steps ran back-to-back inside a single
        // invocation. Persisting after every step is what makes backgrounding
        // `runLoop` (below) actually show real incremental progress instead
        // of one silent gap followed by a sudden final-state jump.
        await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: { status: session.status, currentStep: session.currentStep, plan: session.plan, observations: session.observations, context: session.context, evidenceIds: session.evidenceIds, nextAction: session.nextAction } }).catch(() => { /* best-effort progress persistence — the final write at the end of runLoop remains authoritative */ });
      };

      /** Run the loop until completion or a pause point (approval / user input / failure). */
      const runLoop = async (session: OperatorRuntimeSession, role: OperatorRole, tools: OperatorTool[]): Promise<OperatorRuntimeSession> => {
        session.status = 'running';
        while (session.currentStep < session.plan.length) {
          const stepDef = session.plan[session.currentStep];
          if (!stepDef) break;
          const tool = tools.find((t) => t.toolId === stepDef.toolId);
          if (!tool) { stepDef.status = 'failed'; stepDef.observation = 'Unknown tool.'; session.currentStep++; continue; }
          if (!tool.available) {
            stepDef.status = 'manual_required';
            stepDef.observation = `${tool.name} unavailable: ${tool.unavailableReason}.`;
            session.observations.push(stepDef.observation);
            await recordStep(session, stepDef, `${tool.name} skipped — ${tool.unavailableReason}`, stepDef.observation, 'manual_required');
            session.currentStep++;
            continue;
          }
          if (needsGate(tool) && stepDef.status !== 'awaiting_approval') {
            const perm: OperatorToolPermission = { permissionId: genId('operm'), runtimeSessionId: session.runtimeSessionId, stepId: stepDef.stepId, toolId: tool.toolId, prompt: `${tool.name}: ${stepDef.reason}. Risk ${tool.riskLevel}${tool.ownerOnly ? ' (owner only)' : ''}. ${tool.rollbackAvailable ? 'Rollback available.' : ''}`, riskLevel: tool.riskLevel, ownerOnly: tool.ownerOnly, status: 'pending', decidedBy: null, createdAt: nowIso(), decidedAt: null };
            await opPermissions.insertOne(perm);
            session.approvalIds.push(perm.permissionId);
            stepDef.status = 'awaiting_approval';
            session.status = 'waiting_approval';
            session.nextAction = `Approve or reject: ${tool.name} (${tool.riskLevel} risk).`;
            await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_APPROVAL_REQUESTED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, permissionId: perm.permissionId, toolId: tool.toolId, message: `Approval needed: ${tool.name}`, level: 'warn' } });
            break;
          }
          // Execute. Cross-step context: workspace/migration ids flow forward.
          stepDef.status = 'running';
          if (stepDef.args.workspaceId === undefined && session.context.workspaceId !== undefined && /workspace|migration/.test(tool.toolId)) stepDef.args.workspaceId = session.context.workspaceId;
          if (stepDef.args.migrationId === undefined && session.context.migrationId !== undefined && /migration|promote|rollback/.test(tool.toolId)) stepDef.args.migrationId = session.context.migrationId;
          const run: OperatorToolRun = { toolRunId: genId('orun'), runtimeSessionId: session.runtimeSessionId, stepId: stepDef.stepId, toolId: tool.toolId, args: stepDef.args, status: 'running', resultSummary: '', failureCause: '', evidenceIds: [], startedAt: nowIso(), finishedAt: null };
          await opToolRuns.insertOne(run);
          session.toolRunIds.push(run.toolRunId);
          try {
            const exec = executors[tool.toolId];
            const res = exec ? await exec(stepDef.args, role) : { ok: false, summary: 'No executor bound (registry bug).' };
            stepDef.status = res.ok ? 'done' : 'failed';
            stepDef.observation = res.summary;
            stepDef.toolRunId = run.toolRunId;
            session.observations.push(res.summary);
            const rd = res.data as { workspaceId?: string; migration?: { migrationId?: string } } | undefined;
            if (rd?.workspaceId) session.context.workspaceId = rd.workspaceId;
            if (rd?.migration?.migrationId) session.context.migrationId = rd.migration.migrationId;
            if (res.evidenceIds?.length) session.evidenceIds.push(...res.evidenceIds);
            await opToolRuns.updateOne({ toolRunId: run.toolRunId }, { $set: { status: res.ok ? 'succeeded' : 'failed', resultSummary: res.summary, evidenceIds: res.evidenceIds ?? [], finishedAt: nowIso() } });
            await recordStep(session, stepDef, narrateStep(tool.name, res.ok, res.summary), res.summary, stepDef.status);
            if (!res.ok) {
              const fa = classifyToolFailure(tool.toolId, res.summary);
              session.nextAction = fa.nextAction;
              session.observations.push(`Cause: ${fa.cause} Next: ${fa.nextAction}`);
              if (fa.mistakeMemory) { const mid = await writeOpMemory(role, 'mistake_avoidance', fa.mistakeMemory, session.runtimeSessionId, tool.toolId); session.memoryIds.push(mid); }
              await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_TOOL_FAILED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, toolId: tool.toolId, message: `${tool.name} failed: ${fa.cause}`, level: 'error' } });
              // Observational failures don't kill the session; failures in the
              // critical chain (code/test/service/deploy/…) STOP it — a session
              // with failed critical steps is never reported as completed.
              // Phase AG.3 — completedAt must be set on every terminal exit, not
              // only the "reached the end of the plan" path below. Leaving it
              // null on an early-failure break made this session sort/display
              // as stale relative to later-completed sessions (see decision-log).
              if (stopSessionOnFailure(tool.category)) { session.status = 'failed'; session.completedAt = nowIso(); break; }
            } else {
              await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_TOOL_EXECUTED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, toolId: tool.toolId, message: res.summary.slice(0, 160), level: 'success' } });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'tool crashed';
            stepDef.status = 'failed'; stepDef.observation = msg;
            const fa = classifyToolFailure(tool.toolId, msg);
            session.observations.push(`${tool.name} failed. Cause: ${fa.cause} Next: ${fa.nextAction}`);
            if (fa.mistakeMemory) { const mid = await writeOpMemory(role, 'mistake_avoidance', fa.mistakeMemory, session.runtimeSessionId, tool.toolId); session.memoryIds.push(mid); }
            await opToolRuns.updateOne({ toolRunId: run.toolRunId }, { $set: { status: 'failed', resultSummary: msg, failureCause: fa.cause, finishedAt: nowIso() } });
            await recordStep(session, stepDef, narrateStep(tool.name, false, fa.cause), msg, 'failed');
            session.status = 'failed'; session.nextAction = fa.nextAction; session.completedAt = nowIso();
            break;
          }
          session.currentStep++;
        }
        if (session.currentStep >= session.plan.length && session.status === 'running') {
          const failedSteps = session.plan.filter((s) => s.status === 'failed');
          if (failedSteps.length > 0) {
            // Honest outcome: reaching the end of the plan with failures is a
            // FAILURE, reported with what failed and what to do next.
            session.status = 'failed';
            session.completedAt = nowIso();
            session.reportSummary = `${failedSteps.length} step(s) failed: ${failedSteps.map((s) => `${s.toolId} (${s.observation.slice(0, 100)})`).join('; ')}`;
            if (!session.nextAction) session.nextAction = 'Inspect the failing step observations, apply targeted edits, and re-run.';
            await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_TOOL_FAILED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, message: `Operator session finished with failures: ${session.reportSummary.slice(0, 160)}`, level: 'error' } });
          } else {
            session.status = 'completed';
            session.completedAt = nowIso();
            const lastObs = session.observations[session.observations.length - 1] ?? '';
            session.reportSummary = session.scope === 'user'
              ? lastObs
              : session.observations.slice(-6).join(' ');
            if (session.plan.some((s) => s.status === 'manual_required')) {
              session.nextAction = 'Some steps need configuration or a manual path — see observations.';
            } else {
              const qIdx = lastObs.lastIndexOf('Question:');
              session.nextAction = qIdx >= 0
                ? lastObs.slice(qIdx).trim()
                : 'Done. Give me the next goal.';
            }
            const mid = await writeOpMemory(role, 'workflow', `Goal “${session.goal.slice(0, 80)}” completed with ${session.plan.length} steps.`, session.runtimeSessionId, null);
            session.memoryIds.push(mid);
            await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_SESSION_COMPLETED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, message: `Operator session completed: ${session.goal.slice(0, 80)}`, level: 'success' } });
          }
        }
        // Phase AE item 6 — post-task completion summary composer. Replaces the
        // raw mechanical reportSummary with a grounded, bilingual Jarvis reply
        // for whichever surface displays session outcomes. Best-effort: a
        // failure here must never block persisting the session's real status.
        if (session.status === 'completed' || session.status === 'failed') {
          try {
            const lang = detectLanguage(session.goal);
            const forceFallback = (await isSafeMode()) && jarvisGov.safeModeFallback;
            const { data: completion } = await composeTaskCompletionSummary(jarvisRouter, {
              goal: session.goal,
              status: session.status,
              observations: session.observations,
              reportSummary: session.reportSummary,
              evidenceCount: session.evidenceIds.length,
              language: lang,
              taskId: null,
              forceFallback,
            });
            session.context.jarvisSummary = completion.reply;
            session.context.jarvisSummaryLanguage = completion.language;
            session.context.jarvisSummaryFollowUps = completion.suggestedFollowUps;
          } catch { /* completion summary is best-effort; never blocks session persistence */ }
        }
        await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: session }, { upsert: true });
        return session;
      };


      const deps: GatewayDeps = {
        env,
        ctx,
        guard,
        deny,
        headerStr,
        clientIp,
        userAgent,
        declaredRole,
        resolveAuth,
        userAccounts,
        sessionsCol,
        provisionUser,
        writeAudit,
        writeSecEvent,
        rateLimited,
        enforce,
        envAuditInput,
        isSafeMode,
        SAFE_MODE_SETTING,
        mutationLimiter,
        saveOp,
        executeViaApi,
        runVerification,
        TERMINAL,
        dokployClient,
        dokployApiConfigured,
        dokploySync,
        voiceServiceUrl,
        createKernelTask,
        dispatchTaskToOrchestrator,
        agentQueueClient,
        loadGraphInput,
        userStamp,
        codeAgentTask,
        liveRegistry,
        executors,
        gatherJarvisFacts,
        composeAndRecordJarvisTurn,
        recordStep,
        runLoop,
        jarvisRouter,
        jarvisGov,
        tasks,
        approvals,
        infra,
        events,
        capabilities,
        gaps,
        proposals,
        evaluations,
        llmTraces,
        skills,
        validations,
        githubOps,
        evidence,
        activations,
        checklists,
        monitorRuns,
        incidents,
        repairTasks,
        repairDiagnoses,
        repairPlans,
        strategicPlans,
        planScores,
        policyDecisions,
        decisionMemories,
        outcomeReviews,
        scoringProfiles,
        scoringProposals,
        policyRules,
        policyProposals,
        rolesCol,
        permsCol,
        usersCol,
        auditLogs,
        learningRuns,
        reliabilityScores,
        operationalPatterns,
        memorySummaries,
        compressedContexts,
        systemRecommendations,
        promptPerformance,
        learningSchedules,
        learningTriggers,
        improvementWorkflows,
        impactAssessments,
        memoryMaintenanceRuns,
        securityChecks,
        securityEvents,
        systemSettings,
        llmCostRecords,
        llmBudgetEvents,
        researchRuns,
        researchSources,
        researchReports,
        reviewReports,
        qaReports,
        intelligenceReports,
        operationPlans,
        dokployTargets,
        deploymentSnapshots,
        dokployDiagnostics,
        voiceSessions,
        voiceMessages,
        voiceToolCalls,
        voicePermissions,
        voiceMemories,
        evidenceCol,
        jarvisTurns,
        jarvisMemoryFacts,
        jarvisAnswerScores,
        jarvisBriefings,
        tenantsCol,
        // userProfiles/memberships/consentGrants/connectorAccounts/connectorSyncRuns
        // deliberately absent — K1.4f (D-163). See declarations above.
        userGoals,
        dailyBriefings,
        accessDecisions,
        realityProfiles,
        personalAssets,
        personalProjects,
        personalSystems,
        personalRisks,
        personalOpportunities,
        personalIncomeStreams,
        personalCareerRecords,
        resumeProfiles,
        nextBestActions,
        personalBriefingRuns,
        strategyReviewRuns,
        opTools,
        opToolRuns,
        opPermissions,
        opSessions,
        opSteps,
        opMemories,
      };

      registerAuthRoutes(app, deps);
      registerTasksRoutes(app, deps);
      registerAgentJobsRoutes(app, deps);
      registerCapabilitiesRoutes(app, deps);
      registerGovernanceRoutes(app, deps);
      registerSecurityRoutes(app, deps);
      registerOperationsRoutes(app, deps);
      registerIntelligenceRoutes(app, deps);
      registerVoiceRoutes(app, deps);
      registerPersonalRoutes(app, deps);
      registerOperatorRoutes(app, deps);
      registerJarvisRoutes(app, deps); // K2 D-177 — persistent Jarvis on the shared agent loop
      registerCinRoutes(app, deps); // CIN-1 D-179 — entity graph + claims + ledger
      registerStreamRoutes(app, deps); // CIN-2 D-180 — owner stream + heartbeat
      registerSystemRoutes(app, deps);
    },
  });

  return service;
}
