/**
 * Gateway API — entry point.
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
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  INTERNAL_TOKEN_HEADER,
  ROLE_HEADER,
  REQUEST_ID_HEADER,
  peerUrl,
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
  canAccess,
  buildAccessDecision,
  stampScope,
  buildEsanSeed,
  legacyRoleToAuthContext,
  classifyGoalScope,
  ESAN_TENANT_ID,
  ESAN_USER_ID,
  type AuthContext,
  type AccessRequest,
  type Tenant,
  type UserProfile,
  type TenantMembership,
  type ConsentGrant,
  type ConnectorAccount,
  type ConnectorSyncRun,
  type ScopedMemory,
  type UserGoal,
  type DailyBriefing,
  type OpportunityReport,
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
  type PersonalHealthState,
  type PersonalLifeItem,
  type PersonalFinanceItem,
  type PersonalLearningTrack,
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
import { createFactoryService } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema));

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
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

  // Rate limiters (in-memory; swap for Redis later). Login is enforced in the
  // dashboard; here we protect task creation, approvals, and mutations.
  const mutationLimiter = new RateLimiter(60, 60_000);
  setInterval(() => mutationLimiter.sweep(), 120_000).unref?.();

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

      // Dashboard/human (admin token) OR another service (internal token).
      const guard = (req: { headers: Record<string, string | string[] | undefined> }) =>
        hasValidAdminToken({
          headers: req.headers,
          expectedInternalToken: env.FACTORY_INTERNAL_TOKEN,
          expectedAdminToken: env.FACTORY_ADMIN_TOKEN,
        }) ||
        hasValidInternalToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN });

      const deny = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
        reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'admin or internal token required'));

      // --- Phase 12 security helpers --------------------------------------
      type Req = { headers: Record<string, string | string[] | undefined>; ip?: string };
      type FastifyReplyLike = { code: (n: number) => { send: (b: unknown) => unknown }; header: (k: string, v: unknown) => unknown };
      const headerStr = (req: Req, name: string): string => {
        const v = req.headers[name];
        return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
      };
      const clientIp = (req: Req): string => headerStr(req, 'x-forwarded-for').split(',')[0]?.trim() || req.ip || '';
      const userAgent = (req: Req): string => headerStr(req, 'user-agent');
      /** The role the request acts as. The dashboard's declared role is only trusted with a valid admin token. */
      const declaredRole = (req: Req): RoleName => {
        const isAdmin = hasValidAdminToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN, expectedAdminToken: env.FACTORY_ADMIN_TOKEN });
        if (!isAdmin) return 'agent';
        const r = headerStr(req, ROLE_HEADER);
        return (['owner', 'operator', 'viewer', 'agent'] as const).includes(r as RoleName) ? (r as RoleName) : 'owner';
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
        const res = mutationLimiter.check(`${bucket}:${declaredRole(req)}:${clientIp(req)}`);
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

      // --- Tasks ----------------------------------------------------------
      app.post('/v1/tasks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'task')) return reply;
        if (await enforce('createTask', req, reply)) return reply;
        const parsed = TaskRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid task', parsed.error.issues));
        }
        const now = nowIso();
        const task: Task = {
          taskId: parsed.data.taskId ?? genId('task'),
          goal: parsed.data.goal,
          status: 'queued',
          priority: parsed.data.priority,
          createdBy: 'gateway-api',
          assignedServiceId: null,
          parentTaskId: parsed.data.parentTaskId ?? null,
          requiresApproval: false,
          tags: [],
          error: null,
          createdAt: now,
          updatedAt: now,
        };
        await tasks.insertOne(task);
        await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: task.taskId, payload: { goal: task.goal } });

        // Forward to the orchestrator (best-effort; task is persisted regardless).
        // Prefer the registry-resolved URL, fall back to env/localhost discovery
        // so the loop works locally and in independent Dokploy deployments.
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        try {
          await fetch(`${orchestratorUrl}/.factory/task`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
            body: JSON.stringify({ taskId: task.taskId, goal: task.goal, input: parsed.data.input, priority: task.priority }),
          });
          await tasks.updateOne({ taskId: task.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch (e) {
          ctx.log.warn({ err: e }, 'orchestrator forward failed; task remains queued');
        }
        return success(await tasks.findOne({ taskId: task.taskId }, { projection: { _id: 0 } }));
      });

      app.get('/v1/tasks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await tasks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });

      app.get<{ Params: { id: string } }>('/v1/tasks/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const t = await tasks.findOne({ taskId: req.params.id }, { projection: { _id: 0 } });
        if (!t) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'task not found'));
        return success(t);
      });

      app.get<{ Params: { id: string } }>('/v1/tasks/:id/timeline', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await events.find({ taskId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
        return success(rows);
      });

      // --- Services (proxy registry) -------------------------------------
      app.get('/v1/services', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (!env.SERVICE_REGISTRY_URL) return success([]);
        const res = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, {
          headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
        });
        const body = (await res.json()) as unknown;
        return reply.send(body);
      });

      // --- Approvals ------------------------------------------------------
      app.get('/v1/approvals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await approvals.find({ status: 'pending' }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success(rows);
      });

      app.post<{ Params: { id: string }; Body: { action: string; reason?: string } }>(
        '/v1/approvals/:id/decision',
        async (req, reply) => {
          if (!guard(req)) return deny(reply);
          if (await rateLimited(req, reply, 'approval')) return reply;
          if (await enforce('decideApproval', req, reply)) return reply;
          const { action, reason } = req.body ?? {};
          const map: Record<string, Approval['status']> = {
            approve: 'approved',
            reject: 'rejected',
            request_changes: 'changes_requested',
          };
          const status = map[action ?? ''];
          if (!status) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
          const res = await approvals.findOneAndUpdate(
            { approvalId: req.params.id },
            { $set: { status, decidedBy: 'admin', decisionReason: reason ?? null, decidedAt: nowIso() } },
            { returnDocument: 'after', projection: { _id: 0 } },
          );
          if (!res) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'approval not found'));
          // Audit the human decision (sensitive action).
          await auditLogs.insertOne(buildAuditLog({ actorType: 'human', actorId: 'admin', role: 'owner', action: `approval_${status}`, targetType: 'approval', targetId: res.approvalId, after: { actionType: res.actionType, status }, reason: reason ?? '' }));
          await ctx.publisher.publish({
            type: EVENT_TYPES.APPROVAL_DECIDED,
            taskId: res.taskId,
            payload: { approvalId: res.approvalId, status, message: `Approval ${status}` },
          });

          // Drive the linked task: approval is the human-in-the-loop gate.
          if (res.taskId) {
            if (status === 'approved') {
              await tasks.updateOne({ taskId: res.taskId }, { $set: { status: 'completed', updatedAt: nowIso() } });
              await ctx.publisher.publish({
                type: EVENT_TYPES.TASK_COMPLETED,
                taskId: res.taskId,
                payload: { message: 'Approved — task completed', via: 'approval' },
              });
            } else if (status === 'rejected') {
              await tasks.updateOne({ taskId: res.taskId }, { $set: { status: 'cancelled', updatedAt: nowIso() } });
              await ctx.publisher.publish({
                type: EVENT_TYPES.TASK_FAILED,
                taskId: res.taskId,
                payload: { message: 'Rejected — task cancelled', via: 'approval' },
              });
            }
          }
          return success(res);
        },
      );

      // --- Infrastructure requests ---------------------------------------
      app.get('/v1/infrastructure', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await infra.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success(rows);
      });

      app.post<{ Params: { id: string } }>('/v1/infrastructure/:id/confirm', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('confirmInfra', req, reply)) return reply;
        // Human asserts "I created this infrastructure". In Phase 2 we mark it
        // fulfilled and record the validation checklist as satisfied; live
        // reachability validation is layered in later.
        const res = await infra.findOneAndUpdate(
          { requestId: req.params.id },
          {
            $set: {
              status: 'fulfilled',
              validation: { domainReachable: true, healthOk: true, internalTokenOk: true, manifestAvailable: true, registered: true },
              updatedAt: nowIso(),
            },
          },
          { returnDocument: 'after', projection: { _id: 0 } },
        );
        if (!res) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'request not found'));
        await ctx.publisher.publish({
          type: EVENT_TYPES.INFRA_REQUEST_FULFILLED,
          taskId: null,
          payload: { requestId: res.requestId, message: `Infrastructure ${res.requestId} confirmed created` },
        });
        return success(res);
      });

      // --- Events (history) ----------------------------------------------
      app.get<{ Querystring: { limit?: string } }>('/v1/events', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const rows = await events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
        return success(rows);
      });

      // --- Phase 3: Capability graph reads -------------------------------
      app.get('/v1/capabilities', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await capabilities.find({}, { projection: { _id: 0 } }).sort({ category: 1, title: 1 }).toArray();
        return success(rows);
      });
      app.get<{ Params: { id: string } }>('/v1/capabilities/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const c = await capabilities.findOne({ capabilityId: req.params.id }, { projection: { _id: 0 } });
        if (!c) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'capability not found'));
        return success(c);
      });
      app.get('/v1/gaps', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await gaps.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/expansion-proposals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await proposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/evaluations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await evaluations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/skills', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await skills.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Querystring: { limit?: string } }>('/v1/llm-traces', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const rows = await llmTraces.find({}, { projection: { _id: 0, prompt: 0, completion: 0, system: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
        return success(rows);
      });

      // --- Phase 3: Expansion proposal decision (approve→build) -----------
      app.post<{ Params: { id: string }; Body: { action: string; reason?: string } }>(
        '/v1/expansion-proposals/:id/decision',
        async (req, reply) => {
          if (!guard(req)) return deny(reply);
          if (await enforce('decideExpansion', req, reply)) return reply;
          const action = req.body?.action ?? '';
          const statusMap: Record<string, ExpansionProposal['status']> = {
            approve: 'approved',
            convert_to_build: 'approved',
            reject: 'rejected',
            request_changes: 'changes_requested',
          };
          const status = statusMap[action];
          if (!status) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));

          const proposal = await proposals.findOneAndUpdate(
            { proposalId: req.params.id },
            { $set: { status, updatedAt: nowIso() } },
            { returnDocument: 'after', projection: { _id: 0 } },
          );
          if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
          await ctx.publisher.publish({
            type: EVENT_TYPES.EXPANSION_DECIDED,
            taskId: proposal.sourceTaskId,
            payload: { proposalId: proposal.proposalId, status, message: `Expansion ${status}: ${proposal.proposedServiceName}` },
          });

          // Approving an expansion converts it into a build task for the orchestrator.
          if (status === 'approved') {
            const now = nowIso();
            const buildTask: Task = {
              taskId: genId('task'),
              goal: `Build approved expansion: ${proposal.proposedServiceName}`,
              status: 'queued',
              priority: 'high',
              createdBy: 'gateway-api',
              assignedServiceId: null,
              parentTaskId: proposal.sourceTaskId,
              requiresApproval: false,
              tags: ['expansion', proposal.missingCapability],
              error: null,
              createdAt: now,
              updatedAt: now,
            };
            await tasks.insertOne(buildTask);
            await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: buildTask.taskId, payload: { goal: buildTask.goal } });
            const orchestrator = await ctx.registry.resolve('orchestrator-agent');
            const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
            try {
              await fetch(`${orchestratorUrl}/.factory/task`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
                body: JSON.stringify({ taskId: buildTask.taskId, goal: buildTask.goal, input: { action: 'build_from_proposal', proposalId: proposal.proposalId }, priority: 'high' }),
              });
              await tasks.updateOne({ taskId: buildTask.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
            } catch (e) {
              ctx.log.warn({ err: e }, 'build forward failed; build task remains queued');
            }
            return success({ proposal, buildTaskId: buildTask.taskId });
          }
          return success({ proposal });
        },
      );

      // --- Phase 4: Reality Execution reads ------------------------------
      app.get('/v1/validations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await validations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Params: { id: string } }>('/v1/validations/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const v = await validations.findOne({ validationId: req.params.id }, { projection: { _id: 0 } });
        if (!v) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'validation not found'));
        const ev = await evidence.find({ taskId: v.taskId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success({ validation: v, evidence: ev });
      });
      app.get('/v1/github', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await githubOps.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Querystring: { taskId?: string; capabilityId?: string } }>('/v1/evidence', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const filter: Record<string, string> = {};
        if (req.query.taskId) filter.taskId = req.query.taskId;
        if (req.query.capabilityId) filter.capabilityId = req.query.capabilityId;
        const rows = await evidence.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(300).toArray();
        return success(rows);
      });

      // --- Phase 5: Live Activation & Runtime Autonomy -------------------
      app.get('/v1/activations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await activations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/activations/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const a = await activations.findOne({ activationId: req.params.id }, { projection: { _id: 0 } });
        if (!a) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'activation not found'));
        const ev = await evidence.find({ taskId: a.taskId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success({ activation: a, evidence: ev });
      });
      app.get('/v1/checklists', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await checklists.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });
      app.post<{ Params: { id: string } }>('/v1/checklists/:id/confirm', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('confirmChecklist', req, reply)) return reply;
        const res = await checklists.findOneAndUpdate({ checklistId: req.params.id }, { $set: { status: 'deployed', updatedAt: nowIso() } }, { returnDocument: 'after', projection: { _id: 0 } });
        if (!res) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'checklist not found'));
        return success(res);
      });
      // "Run activation check" — delegate the live check to the monitor-agent.
      app.post<{ Params: { id: string }; Body: { baseUrl?: string } }>('/v1/checklists/:id/activate', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'activation')) return reply;
        if (await enforce('runActivation', req, reply)) return reply;
        const ck = await checklists.findOne({ checklistId: req.params.id });
        if (!ck) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'checklist not found'));
        const baseUrl = req.body?.baseUrl ?? `https://${ck.subdomain}`;
        const monitor = await ctx.registry.resolve('monitor-agent');
        const monitorUrl = monitor?.domain ?? peerUrl('monitor-agent');
        try {
          const r = await fetch(`${monitorUrl}/.factory/task`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
            body: JSON.stringify({ goal: `Activate ${ck.serviceName}`, input: { action: 'activate_service', serviceName: ck.serviceName, capability: ck.capabilityId, baseUrl } }),
          });
          const body = (await r.json()) as { data?: { activation?: { passed?: boolean } } };
          const passed = Boolean(body.data?.activation?.passed);
          await checklists.updateOne({ checklistId: ck.checklistId }, { $set: { status: passed ? 'activated' : 'deployed', updatedAt: nowIso() } });
          return reply.send(body);
        } catch (e) {
          return reply.code(502).send(failure(ERROR_CODES.UPSTREAM, 'monitor-agent unreachable', String(e)));
        }
      });
      app.get('/v1/monitor', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await monitorRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.get('/v1/incidents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await incidents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get('/v1/repair-tasks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairTasks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      // Integration status: GitHub real/prepared, LLM real/fallback.
      app.get('/v1/system/integrations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const gh = gitHubDeliveryFromEnv();
        return success({ github: { configured: gh.configured, mode: gh.configured ? 'github_api' : 'prepared' }, llm: llmStatusFromEnv() });
      });
      app.get('/v1/llm/status', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const traces = await llmTraces.find({}, { projection: { _id: 0, prompt: 0, completion: 0, system: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        const real = traces.filter((t) => !t.usedFallback).length;
        const totalCost = traces.reduce((a, t) => a + Number(t.costUsd ?? 0), 0);
        return success({ status: llmStatusFromEnv(), traceCount: traces.length, realCount: real, fallbackCount: traces.length - real, invalidCount: traces.filter((t) => !t.valid).length, totalCostUsd: Number(totalCost.toFixed(4)) });
      });

      // --- Phase 6: Autonomous Repair & Execution ------------------------
      app.get('/v1/repair-diagnoses', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairDiagnoses.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get('/v1/repair-plans', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairPlans.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      // Incident detail: failure + diagnosis + plan + repair task + evidence.
      app.get<{ Params: { id: string } }>('/v1/incidents/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const incident = await incidents.findOne({ incidentId: req.params.id }, { projection: { _id: 0 } });
        if (!incident) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'incident not found'));
        const [diagnosis, plan, repairTask, ev] = await Promise.all([
          repairDiagnoses.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          repairPlans.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          repairTasks.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          evidence.find({ serviceName: incident.serviceName }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
        ]);
        return success({ incident, diagnosis, plan, repairTask, evidence: ev });
      });
      app.get<{ Params: { id: string } }>('/v1/repair-tasks/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rt = await repairTasks.findOne({ repairTaskId: req.params.id }, { projection: { _id: 0 } });
        if (!rt) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'repair task not found'));
        return success(rt);
      });

      const delegateExecuteRepair = async (repairPlanId: string, baseUrl?: string): Promise<unknown> => {
        const monitor = await ctx.registry.resolve('monitor-agent');
        const monitorUrl = monitor?.domain ?? peerUrl('monitor-agent');
        const r = await fetch(`${monitorUrl}/.factory/task`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
          body: JSON.stringify({ goal: 'Execute repair', input: { action: 'execute_repair', repairPlanId, baseUrl } }),
        });
        return (await r.json()) as unknown;
      };

      // Approve a repair plan → execute (sensitive actions stay gated by this approval).
      app.post<{ Params: { id: string }; Body: { action: string; baseUrl?: string } }>('/v1/repair-plans/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideRepairPlan', req, reply)) return reply;
        const action = req.body?.action ?? '';
        const map: Record<string, RepairPlan['status']> = { approve: 'approved', reject: 'rejected', request_changes: 'changes_requested' };
        const status = map[action];
        if (!status) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        const plan = await repairPlans.findOneAndUpdate({ repairPlanId: req.params.id }, { $set: { status, updatedAt: nowIso() } }, { returnDocument: 'after', projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'plan not found'));
        await ctx.publisher.publish({ type: EVENT_TYPES.APPROVAL_DECIDED, taskId: null, payload: { repairPlanId: plan.repairPlanId, status, message: `Repair plan ${status}` } });
        if (status === 'approved') {
          const result = await delegateExecuteRepair(plan.repairPlanId, req.body?.baseUrl);
          return reply.send(result);
        }
        return success({ plan });
      });

      // "Mark manual action done" / "re-run validation" → re-execute the plan.
      app.post<{ Params: { id: string }; Body: { baseUrl?: string } }>('/v1/incidents/:id/revalidate', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('revalidateIncident', req, reply)) return reply;
        const plan = await repairPlans.findOne({ incidentId: req.params.id }, { sort: { createdAt: -1 }, projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'no repair plan for incident'));
        const result = await delegateExecuteRepair(plan.repairPlanId, req.body?.baseUrl);
        return reply.send(result);
      });

      // --- Phase 7: Strategic Reasoning ----------------------------------
      app.get<{ Querystring: { taskId?: string } }>('/v1/strategic-plans', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await strategicPlans.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/strategic-plans/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const plan = await strategicPlans.findOne({ planId: req.params.id }, { projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'plan not found'));
        const score = await planScores.findOne({ planId: plan.planId }, { projection: { _id: 0 } });
        return success({ plan, score });
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/plan-scores', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await planScores.find(f, { projection: { _id: 0 } }).sort({ total: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/policy-decisions', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await policyDecisions.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/decision-memory', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await decisionMemories.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/llm-traces/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const t = await llmTraces.findOne({ traceId: req.params.id }, { projection: { _id: 0 } });
        if (!t) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'trace not found'));
        return success(t);
      });

      // --- Phase 8: Learning Governance & Adaptive Intelligence ----------
      // Actor role now comes from declaredRole() (admin+role header, or agent).
      const actorRole = declaredRole;

      app.get('/v1/outcome-reviews', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await outcomeReviews.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/scoring-profiles', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await scoringProfiles.find({}, { projection: { _id: 0 } }).sort({ version: -1 }).toArray()); });
      app.get('/v1/scoring-change-proposals', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await scoringProposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/policy-rules', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await policyRules.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()); });
      app.get('/v1/policy-change-proposals', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await policyProposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()); });
      app.get('/v1/audit-logs', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await auditLogs.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(300).toArray()); });
      app.get('/v1/rbac', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [roles, perms, users] = await Promise.all([
          rolesCol.find({}, { projection: { _id: 0 } }).toArray(),
          permsCol.find({}, { projection: { _id: 0 } }).toArray(),
          usersCol.find({}, { projection: { _id: 0 } }).toArray(),
        ]);
        return success({ roles, permissions: perms, users });
      });

      // Approve/reject a scoring change → versions a new active profile (RBAC + audit).
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/scoring-change-proposals/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideScoringProposal', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_scoring_change')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'scoring_change_denied', targetType: 'scoring_change_proposal', targetId: req.params.id, reason: 'RBAC: missing approve_scoring_change' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve scoring changes`));
        }
        const proposal = await scoringProposals.findOne({ proposalId: req.params.id });
        if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
        if (action !== 'approve') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await scoringProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status, approvedBy: role, decidedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `scoring_change_${status}`, targetType: 'scoring_change_proposal', targetId: proposal.proposalId, reason: 'preserve current profile' });
          return success({ proposal: { ...proposal, status } });
        }
        // Approve: create the next active profile version; archive the old one.
        const activeOld = await scoringProfiles.findOne({ status: 'active' as never });
        const nextVersion = (activeOld?.version ?? 1) + 1;
        if (activeOld) await scoringProfiles.updateOne({ profileId: activeOld.profileId }, { $set: { status: 'archived' } });
        const profile = buildScoringProfile(nextVersion, proposal.proposedWeights, { status: 'active', reason: proposal.reason, approvedBy: role });
        await scoringProfiles.insertOne(profile);
        await scoringProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status: 'approved', approvedBy: role, resultingProfileVersion: nextVersion, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'scoring_profile_changed', targetType: 'scoring_profile', targetId: profile.profileId, before: { version: activeOld?.version ?? null, weights: activeOld?.weights }, after: { version: nextVersion, weights: profile.weights }, reason: proposal.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.SCORING_PROFILE_ACTIVATED, taskId: null, payload: { version: nextVersion, message: `Scoring profile v${nextVersion} active` } });
        return success({ activated: true, profileVersion: nextVersion, profile });
      });

      // Approve/reject a policy change → activates a configurable rule (RBAC + audit).
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/policy-change-proposals/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decidePolicyProposal', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_policy_change')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'policy_change_denied', targetType: 'policy_change_proposal', targetId: req.params.id, reason: 'RBAC: missing approve_policy_change' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve policy changes`));
        }
        const proposal = await policyProposals.findOne({ proposalId: req.params.id });
        if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
        if (action !== 'approve') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await policyProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status, approvedBy: role, decidedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `policy_change_${status}`, targetType: 'policy_change_proposal', targetId: proposal.proposalId });
          return success({ proposal: { ...proposal, status } });
        }
        await policyRules.insertOne({ ...proposal.rule, status: 'active' });
        await policyProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status: 'approved', approvedBy: role, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'policy_rule_changed', targetType: 'policy_rule', targetId: proposal.rule.ruleId, after: proposal.rule, reason: proposal.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.POLICY_PROFILE_ACTIVATED, taskId: null, payload: { ruleId: proposal.rule.ruleId, message: 'Policy rule activated' } });
        return success({ activated: true, rule: proposal.rule });
      });

      // --- Phase 9: Operational Learning & Memory Intelligence -----------
      app.get('/v1/learning-runs', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });
      app.get('/v1/reliability', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await reliabilityScores.find({}, { projection: { _id: 0 } }).sort({ lastUpdatedAt: -1 }).limit(300).toArray()); });
      app.get('/v1/patterns', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await operationalPatterns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/memory-summaries', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await memorySummaries.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/compressed-contexts', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await compressedContexts.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });
      app.get('/v1/system-recommendations', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await systemRecommendations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/prompt-performance', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await promptPerformance.find({}, { projection: { _id: 0 } }).sort({ lastUpdatedAt: -1 }).limit(100).toArray()); });

      // Approve/convert a system recommendation (RBAC + audit). Approving converts it to a task.
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/system-recommendations/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideRecommendation', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'convert_to_task', 'convert_to_workflow', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_recommendation')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'recommendation_denied', targetType: 'system_recommendation', targetId: req.params.id, reason: 'RBAC: missing approve_recommendation' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve recommendations`));
        }
        const rec = await systemRecommendations.findOne({ recommendationId: req.params.id });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'recommendation not found'));
        if (action === 'reject' || action === 'request_changes') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await systemRecommendations.updateOne({ recommendationId: rec.recommendationId }, { $set: { status, updatedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `recommendation_${status}`, targetType: 'system_recommendation', targetId: rec.recommendationId });
          await ctx.publisher.publish({ type: EVENT_TYPES.RECOMMENDATION_DECIDED, taskId: null, payload: { recommendationId: rec.recommendationId, status } });
          return success({ recommendation: { ...rec, status } });
        }
        // Approve / convert → mark approved, then run the improvement workflow
        // pipeline (convert → execute → impact) via the orchestrator.
        const now = nowIso();
        await systemRecommendations.updateOne({ recommendationId: rec.recommendationId }, { $set: { status: 'approved', updatedAt: now } });
        const newTask: Task = { taskId: genId('task'), goal: 'Turn the latest learning recommendation into an improvement workflow and measure the result', status: 'queued', priority: 'normal', createdBy: 'gateway-api', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags: ['improvement', rec.type], error: null, createdAt: now, updatedAt: now };
        await tasks.insertOne(newTask);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'recommendation_approved', targetType: 'system_recommendation', targetId: rec.recommendationId, after: { taskId: newTask.taskId, type: rec.type }, reason: rec.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.RECOMMENDATION_DECIDED, taskId: newTask.taskId, payload: { recommendationId: rec.recommendationId, status: 'approved', taskId: newTask.taskId, message: `Recommendation approved → improvement workflow` } });
        await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: newTask.taskId, payload: { goal: newTask.goal } });
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        try {
          await fetch(`${orchestratorUrl}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ taskId: newTask.taskId, goal: newTask.goal, input: { recommendationId: rec.recommendationId } }) });
          await tasks.updateOne({ taskId: newTask.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch (e) { ctx.log.warn({ err: e }, 'improvement task forward failed'); }
        return success({ approved: true, taskId: newTask.taskId });
      });

      // --- Phase 10 reads + learning trigger -----------------------------
      app.get('/v1/learning/schedules', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningSchedules.find({}, { projection: { _id: 0 } }).toArray()); });
      app.get('/v1/learning/triggers', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningTriggers.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });
      app.get('/v1/improvement-workflows', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await improvementWorkflows.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get<{ Params: { id: string } }>('/v1/improvement-workflows/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const wf = await improvementWorkflows.findOne({ workflowId: req.params.id }, { projection: { _id: 0 } });
        if (!wf) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'workflow not found'));
        const impact = wf.impactAssessmentId ? await impactAssessments.findOne({ impactAssessmentId: wf.impactAssessmentId }, { projection: { _id: 0 } }) : null;
        const ev = await evidence.find({ evidenceId: { $in: wf.evidenceIds } as never }, { projection: { _id: 0 } }).toArray();
        return success({ workflow: wf, impact, evidence: ev });
      });
      app.get('/v1/impact-assessments', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await impactAssessments.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/memory-maintenance', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await memoryMaintenanceRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });

      // Trigger a learning run now (manual trigger; the model supports continuous use).
      app.post<{ Body: { type?: string; reason?: string } }>('/v1/learning/trigger', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('triggerLearning', req, reply)) return reply;
        const now = nowIso();
        const trig = { triggerId: genId('trig'), scheduleId: null, type: (req.body?.type ?? 'manual'), reason: req.body?.reason ?? 'manual trigger from dashboard', newRecords: 0, dispatchedTaskId: null as string | null, createdAt: now };
        const learnTask: Task = { taskId: genId('task'), goal: 'Analyze system history and recommend improvements', status: 'queued', priority: 'normal', createdBy: 'gateway-api', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags: ['learning', 'triggered'], error: null, createdAt: now, updatedAt: now };
        await tasks.insertOne(learnTask);
        trig.dispatchedTaskId = learnTask.taskId;
        await learningTriggers.insertOne(trig as never);
        await ctx.publisher.publish({ type: EVENT_TYPES.LEARNING_TRIGGERED, taskId: learnTask.taskId, payload: { triggerId: trig.triggerId, message: 'Learning run triggered' } });
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        try {
          await fetch(`${orchestratorUrl}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ taskId: learnTask.taskId, goal: learnTask.goal, input: {} }) });
          await tasks.updateOne({ taskId: learnTask.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch (e) { ctx.log.warn({ err: e }, 'learning trigger forward failed'); }
        return success({ triggered: true, taskId: learnTask.taskId });
      });
      app.post<{ Params: { id: string } }>('/v1/learning/schedules/:id/toggle', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const sc = await learningSchedules.findOne({ scheduleId: req.params.id });
        if (!sc) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'schedule not found'));
        await learningSchedules.updateOne({ scheduleId: sc.scheduleId }, { $set: { enabled: !sc.enabled, updatedAt: nowIso() } });
        return success({ scheduleId: sc.scheduleId, enabled: !sc.enabled });
      });

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

      app.get('/v1/security/safe-mode', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success({ enabled: await isSafeMode() });
      });
      app.post<{ Body: { enabled?: boolean } }>('/v1/security/safe-mode', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('setSafeMode', req, reply)) return reply;
        const enabled = Boolean(req.body?.enabled);
        await systemSettings.updateOne({ settingId: SAFE_MODE_SETTING }, { $set: { value: enabled, updatedAt: nowIso() } }, { upsert: true });
        const role = declaredRole(req);
        await writeAudit({ actorType: 'human', actorId: role, role, action: enabled ? 'safe_mode_enabled' : 'safe_mode_disabled', targetType: 'safe_mode', targetId: SAFE_MODE_SETTING, after: { enabled } });
        await writeSecEvent({ eventType: EVENT_TYPES.SAFE_MODE_CHANGED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: 'safe_mode', result: 'info', riskLevel: enabled ? 'high' : 'low', detail: `safe mode ${enabled ? 'enabled' : 'disabled'}` });
        await ctx.publisher.publish({ type: EVENT_TYPES.SAFE_MODE_CHANGED, taskId: null, payload: { enabled, message: `Safe mode ${enabled ? 'ENABLED' : 'disabled'}` } });
        return success({ enabled });
      });

      app.get('/v1/security/env', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const audit = auditEnvironment(envAuditInput());
        return success({ ...audit, safeMode: await isSafeMode() });
      });

      app.post('/v1/security/check', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('runSecurityCheck', req, reply)) return reply;
        const audit = auditEnvironment(envAuditInput());
        const check = buildSecurityCheck('system', audit, await isSafeMode());
        await securityChecks.insertOne(check);
        const role = declaredRole(req);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'security_check_run', targetType: 'security_check', targetId: check.checkId, after: { passed: check.passed, riskLevel: check.riskLevel } });
        await writeSecEvent({ eventType: EVENT_TYPES.SECURITY_CHECK_COMPLETED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: 'system', result: check.passed ? 'success' : 'failure', riskLevel: check.riskLevel, detail: `security check ${check.passed ? 'passed' : 'found issues'} (${check.riskLevel})` });
        await ctx.publisher.publish({ type: EVENT_TYPES.SECURITY_CHECK_COMPLETED, taskId: null, payload: { checkId: check.checkId, passed: check.passed, riskLevel: check.riskLevel, message: `Security check ${check.passed ? 'passed' : 'found issues'}` } });
        return success(check);
      });
      app.get('/v1/security/checks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await securityChecks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.get<{ Querystring: { limit?: string } }>('/v1/security/events', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        return success(await securityEvents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray());
      });
      app.get('/v1/security/rate-limits', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success({ buckets: mutationLimiter.snapshot() });
      });
      // The dashboard reports auth events (login/logout/denials) here. Trusted by token.
      app.post<{ Body: { eventType: string; actorId?: string; role?: string; result?: SecurityEvent['result']; target?: string; detail?: string; riskLevel?: SecurityEvent['riskLevel'] } }>('/v1/security/event', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const b = req.body ?? { eventType: 'unknown' };
        const evt = await writeSecEvent({ eventType: b.eventType, actorId: b.actorId ?? 'anonymous', role: b.role ?? null, ip: clientIp(req), userAgent: userAgent(req), target: b.target ?? '', result: b.result ?? 'info', riskLevel: b.riskLevel ?? 'low', detail: b.detail ?? '' });
        // Mirror denials/failures into the audit trail for a single governance record.
        if (b.result === 'denied' || b.result === 'failure') {
          await writeAudit({ actorType: b.role === 'agent' ? 'agent' : 'human', actorId: b.actorId ?? 'anonymous', role: (['owner', 'operator', 'viewer', 'agent'] as string[]).includes(b.role ?? '') ? (b.role as RoleName) : null, action: `security_${b.eventType}`, targetType: 'security', targetId: b.target ?? b.eventType, reason: b.detail ?? '' });
        }
        return success(evt);
      });

      // --- Phase 15/16: Safe Real Operations -----------------------------
      const dokployApiConfigured = isDokployConfigured();
      const dokployClient: DokployClient | null = dokployClientFromEnv();
      let lastDokploySyncAt: string | null = null;
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

      app.get('/v1/operations', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await operationPlans.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });
      app.get('/v1/operations/active', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(20).toArray();
        // Only a genuinely in-flight (non-terminal) operation is "active". Terminal
        // ones (completed/failed/rolled_back/cancelled) must never occupy the panel.
        const active = rows.find((p) => !TERMINAL.has(p.status)) ?? null;
        return success(active);
      });
      app.get<{ Params: { id: string } }>('/v1/operations/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id }, { projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        const [snapshot, target] = await Promise.all([
          plan.snapshotId ? deploymentSnapshots.findOne({ snapshotId: plan.snapshotId }, { projection: { _id: 0 } }) : null,
          plan.targetId ? dokployTargets.findOne({ targetId: plan.targetId }, { projection: { _id: 0 } }) : null,
        ]);
        return success({ plan, snapshot, target });
      });
      app.get('/v1/dokploy-targets', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await dokployTargets.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });

      // Create an operation plan (no mutation yet → not safe-mode blocked).
      app.post<{ Body: { goal?: string; operationType?: string } }>('/v1/operations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('createOperation', req, reply)) return reply;
        const goal = String(req.body?.goal ?? '').trim();
        const opType = (req.body?.operationType ?? 'health_check_only') as OperationType;
        if (!goal) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'goal is required'));
        const plan = buildOperationPlan({ goal, operationType: opType });
        await saveOp(plan);
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_CREATED, taskId: null, payload: { operationPlanId: plan.operationPlanId, message: `Operation plan created (${plan.operationType})` } });
        return success(plan);
      });

      // Confirm / select the Dokploy target.
      app.post<{ Params: { id: string }; Body: Partial<DokployTarget> & { envVarsRequired?: string[] } }>('/v1/operations/:id/target', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('confirmOperationTarget', req, reply)) return reply;
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        const b = req.body ?? {};
        const targetService = String(b.serviceId ?? plan.targetService ?? '');
        // Re-classify with the now-known target service (protected core escalates to critical).
        const cls = classifyOperation(plan.operationType === 'protected_core_update' ? 'existing_app_update' : plan.operationType, targetService);
        plan.targetProject = String(b.projectName ?? plan.targetProject);
        plan.targetEnvironment = String(b.environmentName ?? plan.targetEnvironment);
        plan.targetApp = String(b.appName ?? plan.targetApp);
        plan.targetService = targetService;
        plan.targetDomain = String(b.domain ?? plan.targetDomain);
        plan.targetPort = (b.port as number | null) ?? plan.targetPort;
        plan.rootDir = String(b.rootDir ?? plan.rootDir);
        plan.envVarsRequired = b.envVarsRequired ?? plan.envVarsRequired;
        plan.operationType = cls.operationType;
        plan.riskLevel = cls.riskLevel;
        plan.protectedCore = cls.protectedCore;
        plan.requiredApprovals = cls.requiredApprovals;
        plan.manualInstructions = dokployApiConfigured ? [] : buildManualInstructions(plan);
        plan.steps = setStep(plan.steps, 'target', 'done', `Target: ${plan.targetApp || plan.targetService || 'new app'} @ ${plan.targetDomain || 'n/a'}`, declaredRole(req));

        // Persist the real (manual-confirmed) target.
        const target: DokployTarget = {
          targetId: genId('dtgt'), projectName: plan.targetProject || 'default', environmentName: plan.targetEnvironment,
          appName: plan.targetApp || plan.targetService || 'new-app', serviceId: targetService, domain: plan.targetDomain,
          port: plan.targetPort, rootDir: plan.rootDir, isCoreService: isProtectedCore(targetService),
          lastKnownStatus: 'unknown', lastSyncedAt: null, source: dokployApiConfigured ? 'dokploy_api' : 'manual_user_confirmed', createdAt: nowIso(),
        };
        await dokployTargets.insertOne(target);
        plan.targetId = target.targetId;

        if (plan.operationType === 'health_check_only') {
          // Read-only: no approval needed — verify immediately.
          plan.steps = setStep(plan.steps, 'risk', 'done', 'Read-only health check (low risk)');
          plan.steps = setStep(plan.steps, 'execute', 'done', 'Health check started');
          plan.steps = setStep(plan.steps, 'run', 'done', 'Checking /health');
          plan.status = 'verifying';
          await saveOp(plan);
          const v = await runVerification(plan);
          plan.verification = v;
          const ev = buildEvidence({ type: 'health_check_result', taskId: plan.taskId, serviceName: plan.targetService || null, summary: `Health check: ${v.detail}`, data: { ...v } });
          await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId);
          plan.steps = setStep(plan.steps, 'health', v.healthOk ? 'done' : 'failed', v.detail, 'system', ev.evidenceId);
          plan.steps = setStep(plan.steps, 'registry', v.registered ? 'done' : 'skipped', `registry: ${v.registered ? 'registered' : 'n/a'}`);
          plan.steps = setStep(plan.steps, 'evidence', 'done', 'Evidence stored', 'system', ev.evidenceId);
          plan.steps = setStep(plan.steps, 'completed', v.healthOk === false ? 'failed' : 'done');
          plan.status = v.healthOk === false ? 'failed' : 'completed';
          await saveOp(plan);
          return success(plan);
        }
        plan.steps = setStep(plan.steps, 'risk', 'active', `Risk: ${plan.riskLevel}${plan.protectedCore ? ' (protected core)' : ''}`);
        plan.steps = setStep(plan.steps, 'approval_request', 'waiting', `Awaiting ${plan.requiredApprovals.join('/') || 'owner'} approval`);
        plan.status = 'waiting_approval';
        await saveOp(plan);
        return success(plan);
      });

      // Approve / reject / request changes. Protected/critical → OWNER only. Safe mode blocks mutation.
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/operations/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideOperation', req, reply)) return reply;
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        const role = declaredRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));

        if ((plan.protectedCore || plan.riskLevel === 'critical') && action === 'approve' && role !== 'owner') {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'operation_protected_denied', targetType: 'operation_plan', targetId: plan.operationPlanId, reason: 'protected core / critical requires owner' });
          await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: plan.operationPlanId, result: 'denied', riskLevel: 'high', detail: 'protected/critical operation requires OWNER approval' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'protected core / critical operation requires OWNER approval'));
        }
        if (action === 'approve' && (await isSafeMode())) {
          await writeAudit({ actorType: 'human', actorId: role, role, action: 'operation_blocked_safe_mode', targetType: 'operation_plan', targetId: plan.operationPlanId, reason: 'safe mode active' });
          await writeSecEvent({ eventType: EVENT_TYPES.SAFE_MODE_CHANGED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: plan.operationPlanId, result: 'denied', riskLevel: 'high', detail: 'operation blocked: safe mode active' });
          return reply.code(403).send(failure(ERROR_CODES.SAFE_MODE, 'safe mode is active — operations are disabled'));
        }

        if (action === 'reject') {
          plan.status = 'cancelled'; plan.steps = setStep(plan.steps, 'approval_request', 'failed', 'Rejected', role);
          await writeAudit({ actorType: 'human', actorId: role, role, action: 'operation_rejected', targetType: 'operation_plan', targetId: plan.operationPlanId });
          await saveOp(plan); return success(plan);
        }
        if (action === 'request_changes') {
          plan.status = 'waiting_target_selection'; plan.steps = setStep(plan.steps, 'target', 'active', 'Changes requested', role);
          await saveOp(plan); return success(plan);
        }
        // approve
        plan.steps = setStep(plan.steps, 'risk', 'done');
        plan.steps = setStep(plan.steps, 'approval_request', 'done', 'Approval requested', role);
        plan.steps = setStep(plan.steps, 'approved', 'done', `Approved by ${role}`, role);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'operation_approved', targetType: 'operation_plan', targetId: plan.operationPlanId, after: { operationType: plan.operationType, riskLevel: plan.riskLevel, protectedCore: plan.protectedCore } });
        await writeSecEvent({ eventType: EVENT_TYPES.OPERATION_APPROVED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: plan.operationPlanId, result: 'allowed', riskLevel: plan.riskLevel === 'critical' ? 'high' : 'low', detail: `operation approved (${plan.operationType})` });

        const existing = plan.operationType !== 'new_app';
        if (existing) {
          const snap = buildSnapshot(plan); await deploymentSnapshots.insertOne(snap); plan.snapshotId = snap.snapshotId;
          plan.steps = setStep(plan.steps, 'snapshot', 'done', `Snapshot ${snap.snapshotId} captured (rollback ready)`, 'system');
        }
        plan.status = 'running';
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_APPROVED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, message: `Operation approved (${plan.operationType})`, level: 'success' } });

        // Real Dokploy API execution path (low/medium, non-core, configured, not safe mode).
        if (canAutoExecute(plan) && dokployApiConfigured && !(await isSafeMode())) {
          plan.steps = setStep(plan.steps, 'execute', 'active', 'Executing via Dokploy API');
          const { manualRequired } = await executeViaApi(plan);
          const apiEv = buildEvidence({ type: 'deployment_check', taskId: plan.taskId, serviceName: plan.targetService || null, summary: `Dokploy API execution (${plan.operationType}): ${manualRequired ? 'partial — manual steps required' : 'applied'}`, data: { operationPlanId: plan.operationPlanId, manualRequired } });
          await evidenceCol.insertOne(apiEv); plan.evidenceIds.push(apiEv.evidenceId);
          await writeAudit({ actorType: 'human', actorId: role, role, action: 'operation_api_executed', targetType: 'operation_plan', targetId: plan.operationPlanId, after: { operationType: plan.operationType, manualRequired } });
          await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_EXECUTED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, message: `Dokploy API execution ${manualRequired ? 'needs manual steps' : 'applied'}`, level: manualRequired ? 'warn' : 'success' } });
          if (manualRequired) {
            plan.manualInstructions = buildManualInstructions(plan);
            await saveOp(plan); // stays running; operator finishes remaining steps then /executed
            return success(plan);
          }
          plan.steps = setStep(plan.steps, 'execute', 'done', 'Executed via Dokploy API');
          plan.steps = setStep(plan.steps, 'run', 'done', 'Deploy/restart applied');
          plan.status = 'verifying';
          await saveOp(plan);
          const v = await runVerification(plan); plan.verification = v;
          const ev = buildEvidence({ type: 'health_check_result', taskId: plan.taskId, serviceName: plan.targetService || null, summary: `Operation verification: ${v.detail}`, data: { ...v, operationPlanId: plan.operationPlanId } });
          await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId);
          plan.steps = setStep(plan.steps, 'health', v.healthOk ? 'done' : 'failed', v.detail, 'system', ev.evidenceId);
          plan.steps = setStep(plan.steps, 'registry', v.registered ? 'done' : 'skipped', `registry: ${v.registered ? 'registered' : 'n/a'}`);
          plan.steps = setStep(plan.steps, 'evidence', 'done', 'Evidence stored', 'system', ev.evidenceId);
          const failed = v.healthOk === false;
          plan.steps = setStep(plan.steps, 'completed', failed ? 'failed' : 'done');
          plan.status = failed ? 'failed' : 'completed';
          await writeSecEvent({ eventType: EVENT_TYPES.OPERATION_VERIFIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: plan.operationPlanId, result: failed ? 'failure' : 'success', riskLevel: failed ? 'medium' : 'low', detail: v.detail });
          await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_COMPLETED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, message: `Operation ${plan.status}: ${v.detail}`, level: failed ? 'warn' : 'success' } });
          await saveOp(plan);
          return success(plan);
        }

        // Manual path (API not configured, or not an auto-executable type).
        plan.steps = setStep(plan.steps, 'execute', 'active', 'Manual Dokploy steps issued');
        plan.steps = setStep(plan.steps, 'run', 'waiting', 'Waiting for you to apply the steps in Dokploy');
        plan.manualInstructions = plan.manualInstructions.length ? plan.manualInstructions : buildManualInstructions(plan);
        await saveOp(plan);
        return success(plan);
      });

      // "I did this in Dokploy" (or API completion) → run real verification.
      app.post<{ Params: { id: string }; Body: { baseUrl?: string } }>('/v1/operations/:id/executed', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideOperation', req, reply)) return reply;
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        if (plan.status !== 'running') return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `operation is ${plan.status}, not running`));
        if (req.body?.baseUrl) plan.targetDomain = String(req.body.baseUrl);
        plan.steps = setStep(plan.steps, 'execute', 'done', 'Execution applied', declaredRole(req));
        plan.steps = setStep(plan.steps, 'run', 'done', dokployApiConfigured ? 'Deploy complete' : 'Applied in Dokploy by operator');
        plan.status = 'verifying';
        await saveOp(plan);
        const v = await runVerification(plan); plan.verification = v;
        const ev = buildEvidence({ type: 'health_check_result', taskId: plan.taskId, serviceName: plan.targetService || null, summary: `Operation verification: ${v.detail}`, data: { ...v, operationPlanId: plan.operationPlanId } });
        await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId);
        plan.steps = setStep(plan.steps, 'health', v.healthOk ? 'done' : 'failed', v.detail, 'system', ev.evidenceId);
        plan.steps = setStep(plan.steps, 'registry', v.registered ? 'done' : 'skipped', `registry: ${v.registered ? 'registered' : 'n/a'}`);
        plan.steps = setStep(plan.steps, 'evidence', 'done', 'Evidence stored', 'system', ev.evidenceId);
        const failed = v.healthOk === false;
        plan.steps = setStep(plan.steps, 'completed', failed ? 'failed' : 'done');
        plan.status = failed ? 'failed' : 'completed';
        await writeSecEvent({ eventType: EVENT_TYPES.OPERATION_VERIFIED, actorId: declaredRole(req), role: declaredRole(req), ip: clientIp(req), userAgent: userAgent(req), target: plan.operationPlanId, result: failed ? 'failure' : 'success', riskLevel: failed ? 'medium' : 'low', detail: v.detail });
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_COMPLETED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, message: `Operation ${plan.status}: ${v.detail}`, level: failed ? 'warn' : 'success' } });
        await saveOp(plan);
        return success(plan);
      });

      // Dokploy API connection status (token never returned).
      app.get('/v1/dokploy/status', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        let connection: { ok: boolean; error?: string } = { ok: false, error: 'not configured' };
        if (dokployClient) { const t = await dokployClient.testConnection(); connection = { ok: t.ok, error: t.ok ? undefined : t.error }; }
        const targetCount = await dokployTargets.countDocuments({ source: 'dokploy_api' as never });
        return success({ configured: dokployApiConfigured, connection, lastSyncedAt: lastDokploySyncAt, apiTargetCount: targetCount });
      });

      // Sync real Dokploy projects/apps into dokploy_targets. Never fabricates targets.
      app.post('/v1/dokploy/sync', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'dokploy_sync')) return reply;
        if (await enforce('confirmOperationTarget', req, reply)) return reply;
        if (!dokployClient) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, 'Dokploy API not configured (DOKPLOY_BASE_URL / DOKPLOY_API_TOKEN) — use manual target confirmation'));
        const projects = await dokployClient.listProjects();
        if (!projects.ok) return reply.code(502).send(failure(ERROR_CODES.UPSTREAM, `Dokploy sync failed: ${projects.error ?? 'unreachable'} — manual confirmation remains available`));
        // Calibrated, version-tolerant parse (shared). Missing fields stay empty (UI shows "unknown"); never invented.
        const parsed = parseDokployTargets(projects.data);
        const out: DokployTarget[] = parsed.map((t) => ({
          targetId: genId('dtgt'), projectName: t.projectName, environmentName: t.environmentName,
          appName: t.appName, serviceId: t.serviceId, domain: t.domain, port: t.port, rootDir: t.rootDir,
          isCoreService: isProtectedCore(t.serviceId), lastKnownStatus: t.status || 'unknown', lastSyncedAt: nowIso(), source: 'dokploy_api', createdAt: nowIso(),
        }));
        for (const t of out) await dokployTargets.updateOne({ source: 'dokploy_api' as never, appName: t.appName, projectName: t.projectName }, { $set: t }, { upsert: true });
        lastDokploySyncAt = nowIso();
        return success({ synced: out.length, lastSyncedAt: lastDokploySyncAt, note: out.length === 0 ? 'Connected, but no applications parsed from this Dokploy version — run diagnostics and confirm targets manually.' : undefined });
      });

      // Read-only API discovery: probe real endpoints, store sanitized shapes (no secrets).
      app.post('/v1/dokploy/diagnostics', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'dokploy_diagnostics')) return reply;
        if (await enforce('confirmOperationTarget', req, reply)) return reply;
        if (!dokployClient) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, 'Dokploy API not configured — set DOKPLOY_BASE_URL / DOKPLOY_API_TOKEN. Manual confirmation remains available.'));
        const baseUrl = dokployConfigFromEnv()?.baseUrl ?? '';
        const recs = await buildDiagnostics(dokployClient, baseUrl);
        if (recs.length) await dokployDiagnostics.insertMany(recs as never[]);
        const supported = recs.filter((r) => r.supported).map((r) => r.category);
        const unsupported = recs.filter((r) => !r.supported && r.method === 'GET').map((r) => `${r.category} (${r.error})`);
        return success({ probed: recs.length, supported, unsupported, diagnostics: recs });
      });
      app.get('/v1/dokploy/diagnostics', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await dokployDiagnostics.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(60).toArray());
      });

      // Map the real AOS catalog to synced Dokploy targets (honest not_found_in_dokploy_sync).
      app.get('/v1/dokploy/mapping', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const targets = await dokployTargets.find({ source: 'dokploy_api' as never }, { projection: { _id: 0 } }).toArray();
        const aosIds = (Object.values(SERVICE_IDS) as string[]).filter((id) => id !== 'dashboard-web').concat(['dashboard-web']);
        const mapping = mapAosServices(aosIds, targets);
        return success({ mapping, syncedTargets: targets.length, mappedCount: mapping.filter((m) => m.status === 'mapped').length });
      });

      // Retry the API execution of a running operation whose step failed (retryable).
      app.post<{ Params: { id: string } }>('/v1/operations/:id/retry', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'operation_retry')) return reply;
        if (await enforce('decideOperation', req, reply)) return reply;
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        if (plan.status !== 'running') return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `operation is ${plan.status}, not running`));
        if (await isSafeMode()) return reply.code(403).send(failure(ERROR_CODES.SAFE_MODE, 'safe mode is active'));
        if (!(canAutoExecute(plan) && dokployApiConfigured)) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, 'this operation is on the manual path — apply the steps and confirm'));
        const { manualRequired } = await executeViaApi(plan);
        await writeAudit({ actorType: 'human', actorId: declaredRole(req), role: declaredRole(req), action: 'operation_api_retry', targetType: 'operation_plan', targetId: plan.operationPlanId, after: { manualRequired } });
        if (manualRequired) plan.manualInstructions = buildManualInstructions(plan);
        await saveOp(plan);
        return success(plan);
      });

      // Rollback a failed/changed existing-app operation (OWNER + snapshot required).
      app.post<{ Params: { id: string } }>('/v1/operations/:id/rollback', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideOperation', req, reply)) return reply;
        const role = declaredRole(req);
        if (role !== 'owner') {
          await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: req.params.id, result: 'denied', riskLevel: 'medium', detail: 'rollback requires owner' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'rollback requires OWNER approval'));
        }
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        if (!plan.snapshotId) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, 'no snapshot to roll back to'));
        // Best-effort API redeploy of the previous build if configured; otherwise exact manual rollback steps.
        let mode = 'manual';
        if (dokployClient && plan.targetApp) { const r = await dokployClient.deployApplication(plan.targetApp); mode = r.ok ? 'api' : 'manual'; }
        plan.rollbackPlan = plan.rollbackPlan.length ? plan.rollbackPlan : ['Restore the captured snapshot in Dokploy', 'Redeploy the previous successful build', 'Re-run health + registry verification'];
        plan.status = 'rolled_back';
        plan.steps = setStep(plan.steps, 'completed', 'failed', `Rolled back via ${mode} (snapshot ${plan.snapshotId})`, role);
        const ev = buildEvidence({ type: 'deployment_check', taskId: plan.taskId, serviceName: plan.targetService || null, summary: `Rollback (${mode}) to snapshot ${plan.snapshotId}`, data: { operationPlanId: plan.operationPlanId, snapshotId: plan.snapshotId, mode } });
        await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'operation_rolled_back', targetType: 'operation_plan', targetId: plan.operationPlanId, after: { snapshotId: plan.snapshotId, mode } });
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATION_UPDATED, taskId: plan.taskId, payload: { operationPlanId: plan.operationPlanId, message: `Operation rolled back (${mode})`, level: 'warn' } });
        await saveOp(plan);
        return success(plan);
      });

      // Cancel / discard an operation from ANY non-terminal state (e.g. stuck in
      // waiting_target_selection). Cancelling is a de-escalation: it is never
      // blocked by safe mode and is idempotent. Completed operations cannot be
      // cancelled — only in-flight ones. In-flight steps are marked skipped;
      // already-done steps stay as an honest record of what ran.
      app.post<{ Params: { id: string }; Body: { reason?: string } }>('/v1/operations/:id/cancel', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'operation_cancel')) return reply;
        if (await enforce('decideOperation', req, reply)) return reply;
        const role = declaredRole(req);
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        if (plan.status === 'cancelled') return success(plan); // idempotent
        if (TERMINAL.has(plan.status)) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `operation is ${plan.status} — a finished operation cannot be cancelled`));
        const prev = plan.status;
        const reason = (String(req.body?.reason ?? '').trim() || 'Cancelled by operator').slice(0, 200);
        plan.steps = plan.steps.map((s) =>
          s.status === 'active' || s.status === 'waiting' || s.status === 'manual_required'
            ? { ...s, status: 'skipped' as const, message: reason, actor: role, at: nowIso() }
            : s,
        );
        plan.status = 'cancelled';
        await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'operation_cancelled', targetType: 'operation_plan', targetId: plan.operationPlanId, reason, after: { previousStatus: prev } });
        await saveOp(plan);
        return success(plan);
      });

      // --- Phase 13: Real Intelligence reads -----------------------------
      app.get('/v1/llm/prompts', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(agentPrompts());
      });
      app.get('/v1/llm/costs', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const records = await llmCostRecords.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1000).toArray();
        const todayPrefix = new Date().toISOString().slice(0, 10);
        const byProvider: Record<string, { calls: number; costUsd: number }> = {};
        const byAgent: Record<string, { calls: number; costUsd: number }> = {};
        const byTask: Record<string, number> = {};
        let totalToday = 0, totalAll = 0, fallbackCount = 0, realCount = 0;
        for (const r of records) {
          totalAll += r.costUsd;
          if (String(r.createdAt).slice(0, 10) === todayPrefix) totalToday += r.costUsd;
          (byProvider[r.provider] ??= { calls: 0, costUsd: 0 }).calls++; byProvider[r.provider]!.costUsd += r.costUsd;
          (byAgent[r.agentId] ??= { calls: 0, costUsd: 0 }).calls++; byAgent[r.agentId]!.costUsd += r.costUsd;
          if (r.taskId) byTask[r.taskId] = (byTask[r.taskId] ?? 0) + r.costUsd;
          if (r.usedFallback) fallbackCount++; else realCount++;
        }
        const mostExpensiveTask = Object.entries(byTask).sort((a, b) => b[1] - a[1])[0] ?? null;
        return success({
          status: llmStatusFromEnv(),
          totals: { today: Number(totalToday.toFixed(4)), allTime: Number(totalAll.toFixed(4)), calls: records.length, realCount, fallbackCount },
          byProvider, byAgent,
          mostExpensiveTask: mostExpensiveTask ? { taskId: mostExpensiveTask[0], costUsd: Number(mostExpensiveTask[1].toFixed(4)) } : null,
          recent: records.slice(0, 50),
        });
      });
      app.get('/v1/llm/budget-events', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await llmBudgetEvents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/research', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await researchReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/research/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const report = await researchReports.findOne({ reportId: req.params.id }, { projection: { _id: 0 } });
        if (!report) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'research report not found'));
        const [run, sources] = await Promise.all([
          researchRuns.findOne({ runId: report.runId }, { projection: { _id: 0 } }),
          researchSources.find({ runId: report.runId }, { projection: { _id: 0 } }).toArray(),
        ]);
        return success({ report, run, sources });
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/reviews', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await reviewReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/qa', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await qaReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/reports', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await intelligenceReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });

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

      // Compact, secret-free context packet for the voice operator.
      app.get<{ Querystring: { page?: string } }>('/v1/voice/context', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [op, appr, inc, recentEvents, safe, latestReport] = await Promise.all([
          operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
          approvals.countDocuments({ status: 'pending' }),
          incidents.find({}, { projection: { _id: 0 } }).limit(50).toArray(),
          events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(6).toArray(),
          isSafeMode(),
          intelligenceReports.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray(),
        ]);
        const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
        const openIncidents = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').length;
        return success({
          role: declaredRole(req), safeMode: safe, currentPage: req.query.page ?? '/',
          activeOperation: activeOp ? { operationPlanId: activeOp.operationPlanId, goal: activeOp.goal, status: activeOp.status, riskLevel: activeOp.riskLevel, protectedCore: activeOp.protectedCore, nextAction: activeOp.nextAction } : null,
          pendingApprovals: appr, openIncidents,
          latestEvents: recentEvents.map((e) => ({ type: e.type, message: (e.payload as { message?: string })?.message ?? e.type, at: e.createdAt })),
          latestReport: latestReport[0] ? { reportId: latestReport[0].reportId, title: latestReport[0].title } : null,
          guardrails: VOICE_GUARDRAILS,
        });
      });

      app.post<{ Body: { currentPage?: string } }>('/v1/voice/session', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const role = declaredRole(req);
        const sess: VoiceSession = { voiceSessionId: genId('vsess'), userId: role, role, startedAt: nowIso(), endedAt: null, status: 'active', currentPage: req.body?.currentPage ?? '/', activeTaskId: null, activeOperationPlanId: null, mode: 'collapsed', provider: 'text', model: '', costUsd: 0, transcriptSummary: '', connectionMode: 'text', durationSec: 0, fallbackReason: '', errorSummary: '', toolCallCount: 0, interactionMode: 'push_to_talk' };
        await voiceSessions.insertOne(sess);
        await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_SESSION_STARTED, taskId: null, payload: { voiceSessionId: sess.voiceSessionId, message: 'Voice session started' } });
        return success(sess);
      });
      app.get('/v1/voice/sessions', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await voiceSessions.find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(30).toArray()); });
      app.get<{ Params: { id: string } }>('/v1/voice/sessions/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [s, msgs, calls, perms] = await Promise.all([
          voiceSessions.findOne({ voiceSessionId: req.params.id }, { projection: { _id: 0 } }),
          voiceMessages.find({ sessionId: req.params.id }, { projection: { _id: 0 } }).sort({ timestamp: 1 }).toArray(),
          voiceToolCalls.find({ sessionId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
          voicePermissions.find({ sessionId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
        ]);
        return success({ session: s, messages: msgs, toolCalls: calls, permissions: perms });
      });
      app.get('/v1/voice/memories', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await voiceMemories.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });
      app.get('/v1/voice/tool-calls', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await voiceToolCalls.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });

      // Realtime ephemeral token (proxied to the voice-operator-agent; key never reaches the browser raw).
      app.post('/v1/voice/realtime-token', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'voice_realtime')) return reply;
        try {
          const r = await fetch(`${voiceServiceUrl()}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ goal: 'realtime token', input: { action: 'realtime_token' } }) });
          const body = (await r.json()) as { data?: { realtime?: unknown } };
          return success(body.data?.realtime ?? { ok: false, error: 'voice service unreachable' });
        } catch {
          return success({ ok: false, error: 'voice provider not configured' });
        }
      });

      // Phase 19 — WebRTC SDP exchange proxy. The browser sends its SDP offer +
      // the EPHEMERAL client secret it was issued (never the real API key, which
      // this gateway does not even hold for the voice provider). We forward the
      // offer to the provider and return the answer. Only a sanitized connection
      // event is stored — never SDP contents or the secret.
      app.post<{ Body: { sessionId?: string; clientSecret?: string; model?: string; sdp?: string; apiVariant?: string } }>('/v1/voice/realtime/sdp', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'voice_realtime')) return reply;
        const { sessionId, clientSecret, model, sdp } = req.body ?? {};
        if (!clientSecret || !model || !sdp) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'clientSecret, model and sdp are required'));
        // Ephemeral secrets are short strings; a real API key must never transit here disguised as one.
        if (sdp.length > 100_000 || clientSecret.length > 512) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'payload out of bounds'));
        const attempt = async (url: string, beta: boolean): Promise<{ ok: boolean; status: number; answer?: string }> => {
          try {
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/sdp', authorization: `Bearer ${clientSecret}`, ...(beta ? { 'openai-beta': 'realtime=v1' } : {}) },
              body: sdp, signal: AbortSignal.timeout(15000),
            });
            return r.ok ? { ok: true, status: r.status, answer: await r.text() } : { ok: false, status: r.status };
          } catch { return { ok: false, status: 0 }; }
        };
        const m = encodeURIComponent(model);
        // GA endpoint first; beta shape as fallback (calibration-tolerant, never faked).
        let r = req.body?.apiVariant === 'beta' ? { ok: false, status: 404 } as { ok: boolean; status: number; answer?: string } : await attempt(`https://api.openai.com/v1/realtime/calls?model=${m}`, false);
        if (!r.ok) r = await attempt(`https://api.openai.com/v1/realtime?model=${m}`, true);
        if (!r.ok || !r.answer) {
          await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_REALTIME_DISCONNECTED, taskId: null, payload: { sessionId: sessionId ?? null, message: `Realtime SDP exchange failed (provider status ${r.status || 'unreachable'})`, level: 'warn' } });
          return reply.code(502).send(failure(ERROR_CODES.INTERNAL, r.status === 401 ? 'ephemeral token expired or invalid' : 'realtime provider SDP exchange failed'));
        }
        if (sessionId) await voiceSessions.updateOne({ voiceSessionId: sessionId }, { $set: { connectionMode: 'realtime', provider: 'openai-realtime', model } });
        await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_REALTIME_CONNECTED, taskId: null, payload: { sessionId: sessionId ?? null, model, message: 'Realtime WebRTC session connected', level: 'success' } });
        return success({ sdp: r.answer });
      });

      // Phase 19 — end a voice session with sanitized realtime/cost metadata.
      app.post<{ Params: { id: string }; Body: { durationSec?: number; connectionMode?: string; interactionMode?: string; transcriptSummary?: string; errorSummary?: string; fallbackReason?: string; costUsd?: number } }>('/v1/voice/session/:id/end', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const s = await voiceSessions.findOne({ voiceSessionId: req.params.id });
        if (!s) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'voice session not found'));
        const b = req.body ?? {};
        const clamp = (v: unknown, max: number): string => String(v ?? '').slice(0, max);
        const toolCallCount = await voiceToolCalls.countDocuments({ sessionId: s.voiceSessionId });
        const upd = {
          status: 'ended' as const, endedAt: nowIso(),
          durationSec: Math.max(0, Math.min(Number(b.durationSec ?? 0) || 0, 86_400)),
          connectionMode: ['text', 'browser_speech', 'realtime'].includes(String(b.connectionMode)) ? (b.connectionMode as 'text' | 'browser_speech' | 'realtime') : s.connectionMode ?? 'text',
          interactionMode: ['push_to_talk', 'always_listening'].includes(String(b.interactionMode)) ? (b.interactionMode as 'push_to_talk' | 'always_listening') : 'push_to_talk',
          transcriptSummary: clamp(b.transcriptSummary, 800), errorSummary: clamp(b.errorSummary, 400), fallbackReason: clamp(b.fallbackReason, 200),
          costUsd: Math.max(0, Number(b.costUsd ?? 0) || 0), toolCallCount,
        };
        await voiceSessions.updateOne({ voiceSessionId: s.voiceSessionId }, { $set: upd });
        await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_SESSION_ENDED, taskId: null, payload: { voiceSessionId: s.voiceSessionId, durationSec: upd.durationSec, connectionMode: upd.connectionMode, toolCalls: toolCallCount, message: `Voice session ended (${upd.connectionMode}, ${upd.durationSec}s)` } });
        return success({ ended: true, toolCallCount });
      });

      // The core: route an utterance → a single safe tool proposal (never auto-mutates).
      app.post<{ Body: { sessionId?: string; text?: string; currentPage?: string; modality?: string } }>('/v1/voice/message', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'voice_message')) return reply;
        const role = declaredRole(req);
        const sessionId = String(req.body?.sessionId ?? '');
        const text = String(req.body?.text ?? '').trim();
        if (!sessionId || !text) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'sessionId and text are required'));
        // Phase 19.5 — server-side command hygiene. Protects against client bugs:
        // fragments below minCommandChars are ignored, and an identical normalized
        // command in the same session within the dedupe window is dropped without
        // creating a new tool call or reply.
        const norm = normalizeUtterance(text);
        if (norm.length < 4) return success({ ignored: true, reason: 'too_short', reply: '', proposal: null, toolCall: null, permissionId: null, readData: null, safeMode: false });
        const lastUser = await voiceMessages.find({ sessionId, direction: 'user' }).sort({ timestamp: -1 }).limit(1).toArray();
        if (lastUser[0] && normalizeUtterance(lastUser[0].text) === norm && Date.now() - Date.parse(lastUser[0].timestamp) < 5000) {
          return success({ duplicate: true, reason: 'duplicate_within_window', reply: '', proposal: null, toolCall: null, permissionId: null, readData: null, safeMode: false });
        }

        const safe = await isSafeMode();
        const modality: 'voice' | 'text' = req.body?.modality === 'voice' ? 'voice' : 'text';
        await voiceMessages.insertOne({ messageId: genId('vmsg'), sessionId, direction: 'user', modality, text, timestamp: nowIso(), linkedTaskId: null, linkedOperationPlanId: null });

        const proposal: ToolProposal = routeUtterance(text, { role, safeMode: safe, currentPage: req.body?.currentPage ?? '/' });
        const toolCall: VoiceToolCall = {
          toolCallId: genId('vtool'), sessionId, toolName: proposal.toolName, category: proposal.category, proposedArgs: proposal.args,
          riskLevel: proposal.riskLevel, requiresApproval: proposal.requiresApproval, ownerOnly: proposal.ownerOnly,
          status: proposal.blocked ? 'blocked' : proposal.category === 'read' ? 'executed' : proposal.confirm === 'approval' ? 'awaiting_approval' : 'awaiting_confirmation',
          blockedReason: proposal.blockedReason, resultSummary: '', evidenceIds: [], createdAt: nowIso(),
        };
        let reply_text = proposal.explanation;
        let readData: unknown = null;
        let permissionId: string | null = null;

        // Read tools execute immediately (no mutation). Phase 19.5: replies are
        // composed from LIVE state — short, specific, operator-style. Never a
        // generic capability list.
        if (proposal.category === 'read' && !proposal.blocked) {
          if (proposal.toolName === 'explain_current_page' || proposal.toolName === 'read_status') {
            const [op, apprCount, inc] = await Promise.all([
              operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
              approvals.countDocuments({ status: 'pending' }),
              incidents.find({}, { projection: { _id: 0 } }).limit(50).toArray(),
            ]);
            const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
            const openInc = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').length;
            const parts: string[] = [];
            parts.push(activeOp ? `One active operation: “${activeOp.goal}” — ${activeOp.status.replace(/_/g, ' ')}${activeOp.nextAction ? `. Next: ${activeOp.nextAction}` : ''}.` : 'No operation is executing.');
            if (apprCount > 0) parts.push(`${apprCount} approval${apprCount === 1 ? '' : 's'} waiting.`);
            if (openInc > 0) parts.push(`${openInc} open incident${openInc === 1 ? '' : 's'}.`);
            if (safe) parts.push('Safe mode is ON — mutations are blocked.');
            if (!activeOp && apprCount === 0 && openInc === 0) parts.push('System is quiet. Next step: run a system check or give me a goal.');
            reply_text = parts.join(' ');
            readData = { activeOperation: activeOp ? { operationPlanId: activeOp.operationPlanId, goal: activeOp.goal, status: activeOp.status } : null, pendingApprovals: apprCount, openIncidents: openInc, safeMode: safe };
          } else if (proposal.toolName === 'list_pending_approvals') {
            const items = await approvals.find({ status: 'pending' }, { projection: { _id: 0 } }).limit(10).toArray();
            readData = items;
            reply_text = items.length === 0 ? 'No approvals are waiting.' : `${items.length} approval${items.length === 1 ? '' : 's'} pending. Decide them on the Approvals page or Overview.`;
          } else if (proposal.toolName === 'show_evidence') {
            const items = await evidence.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray();
            readData = items;
            reply_text = items.length === 0 ? 'No evidence records yet.' : `Showing the ${items.length} most recent evidence records.`;
          } else if (proposal.toolName === 'open_report') {
            const items = await intelligenceReports.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray();
            readData = items;
            reply_text = items[0] ? `Latest report: “${items[0].title}”.` : 'No intelligence reports yet.';
          }
          toolCall.resultSummary = `read ${proposal.toolName}`;
        } else if (proposal.blocked) {
          await writeAudit({ actorType: 'human', actorId: role, role, action: `voice_blocked_${proposal.toolName}`, targetType: 'voice_tool_call', targetId: toolCall.toolCallId, reason: proposal.blockedReason });
          await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: proposal.toolName, result: 'denied', riskLevel: proposal.riskLevel === 'critical' ? 'high' : 'medium', detail: `voice blocked: ${proposal.blockedReason}` });
        } else if (proposal.confirm === 'approval') {
          const perm: VoicePermission = { permissionId: genId('vperm'), sessionId, toolCallId: toolCall.toolCallId, prompt: proposal.explanation, riskLevel: proposal.riskLevel, ownerOnly: proposal.ownerOnly, approvedBy: null, status: 'pending', createdAt: nowIso(), decidedAt: null };
          await voicePermissions.insertOne(perm);
          permissionId = perm.permissionId;
          await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_PERMISSION_REQUESTED, taskId: null, payload: { permissionId: perm.permissionId, message: `Voice approval requested (${proposal.riskLevel})`, level: 'warn' } });
        }

        await voiceToolCalls.insertOne(toolCall);
        await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_TOOL_PROPOSED, taskId: null, payload: { toolName: proposal.toolName, status: toolCall.status, message: `Voice proposed ${proposal.toolName}` } });
        await voiceMessages.insertOne({ messageId: genId('vmsg'), sessionId, direction: 'agent', modality: 'text', text: reply_text, timestamp: nowIso(), linkedTaskId: null, linkedOperationPlanId: null });
        return success({ proposal, toolCall, permissionId, reply: reply_text, readData, safeMode: safe });
      });

      // Confirm + execute a low-risk tool through the existing safe paths (RBAC + safe mode enforced).
      app.post<{ Params: { id: string } }>('/v1/voice/tool/:id/confirm', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'voice_tool')) return reply;
        const tc = await voiceToolCalls.findOne({ toolCallId: req.params.id });
        if (!tc) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'tool call not found'));
        if (tc.status !== 'awaiting_confirmation') return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `tool is ${tc.status}`));
        const role = declaredRole(req);
        const args = tc.proposedArgs as { targetService?: string; goal?: string };

        // RBAC + safe-mode for mutations.
        const actionFor: Record<string, string> = { run_health_check: 'createOperation', run_system_status_check: 'createOperation', run_learning_analysis: 'createTask', run_security_check: 'createTask', run_research_plan: 'createTask', sync_dokploy_targets: 'confirmOperationTarget', run_dokploy_diagnostics: 'confirmOperationTarget' };
        const enfAction = actionFor[tc.toolName] ?? 'createOperation';
        if (await enforce(enfAction, req, reply)) return reply;

        let resultSummary = ''; const evidenceIds: string[] = []; let linkedTaskId: string | null = null; let linkedOperationPlanId: string | null = null;
        try {
          if (tc.toolName === 'run_health_check') {
            const plan = buildOperationPlan({ goal: `Health check ${args.targetService ?? ''}`.trim(), operationType: 'health_check_only', target: { targetService: args.targetService ?? '', targetDomain: args.targetService ? `${args.targetService}.simorx.com` : '' } });
            plan.status = 'verifying'; await saveOp(plan);
            const v = await runVerification(plan); plan.verification = v;
            const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: args.targetService ?? null, summary: `Voice health check: ${v.detail}`, data: { ...v, operationPlanId: plan.operationPlanId } });
            await evidenceCol.insertOne(ev); plan.evidenceIds.push(ev.evidenceId); evidenceIds.push(ev.evidenceId);
            plan.steps = setStep(plan.steps, 'health', v.healthOk ? 'done' : 'failed', v.detail, 'voice-operator-agent', ev.evidenceId);
            plan.steps = setStep(plan.steps, 'completed', v.healthOk === false ? 'failed' : 'done');
            plan.status = v.healthOk === false ? 'failed' : 'completed'; await saveOp(plan);
            linkedOperationPlanId = plan.operationPlanId; resultSummary = `Health check ${plan.status}: ${v.detail}`;
          } else if (tc.toolName === 'run_system_status_check') {
            // Read-only aggregation across live state — no mutation anywhere.
            const [taskCount, runningTasks, apprCount, inc, safeNow] = await Promise.all([
              tasks.countDocuments({}),
              tasks.countDocuments({ status: { $in: ['queued', 'planning', 'in_progress'] } }),
              approvals.countDocuments({ status: 'pending' }),
              incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(),
              isSafeMode(),
            ]);
            const openInc = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed').length;
            let serviceCount = -1;
            try {
              const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(4000) });
              const body = (await r.json()) as { data?: unknown[] };
              serviceCount = Array.isArray(body.data) ? body.data.length : -1;
            } catch { /* registry unreachable → reported as unknown, never faked */ }
            const dokploy = dokployClient ? (lastDokploySyncAt ? `synced ${lastDokploySyncAt}` : 'connected, not yet synced') : 'not configured';
            resultSummary = `System check: ${serviceCount >= 0 ? `${serviceCount} services registered` : 'registry unreachable'}; ${taskCount} tasks (${runningTasks} active); ${apprCount} approvals pending; ${openInc} open incidents; safe mode ${safeNow ? 'ON' : 'off'}; Dokploy ${dokploy}.`;
            const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: null, summary: `Voice system check: ${resultSummary}`, data: { serviceCount, taskCount, runningTasks, pendingApprovals: apprCount, openIncidents: openInc, safeMode: safeNow } });
            await evidenceCol.insertOne(ev); evidenceIds.push(ev.evidenceId);
          } else if (tc.toolName === 'run_learning_analysis') { linkedTaskId = await createKernelTask('Analyze system history and recommend improvements', ['learning', 'voice']); resultSummary = `Learning analysis task ${linkedTaskId} started`; }
          else if (tc.toolName === 'run_security_check') { linkedTaskId = await createKernelTask('Run production security hardening check.', ['security', 'voice']); resultSummary = `Security check task ${linkedTaskId} started`; }
          else if (tc.toolName === 'run_research_plan') { linkedTaskId = await createKernelTask(args.goal ?? 'Research current best practices and create an improvement plan.', ['research', 'voice']); resultSummary = `Research task ${linkedTaskId} started`; }
          else if (tc.toolName === 'sync_dokploy_targets') {
            if (!dokployClient) resultSummary = 'Dokploy API not configured — manual confirmation remains available.';
            else { const pr = await dokployClient.listProjects(); resultSummary = pr.ok ? `Synced (${parseDokployTargets(pr.data).length} targets)` : `Dokploy sync failed: ${pr.error}`; if (pr.ok) lastDokploySyncAt = nowIso(); }
          } else if (tc.toolName === 'run_dokploy_diagnostics') {
            resultSummary = dokployClient ? `Diagnostics run (${(await buildDiagnostics(dokployClient, '')).length} probes)` : 'Dokploy API not configured.';
          } else resultSummary = 'No-op';
          await voiceToolCalls.updateOne({ toolCallId: tc.toolCallId }, { $set: { status: 'executed', resultSummary, evidenceIds } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `voice_exec_${tc.toolName}`, targetType: 'voice_tool_call', targetId: tc.toolCallId, after: { resultSummary } });
          await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_TOOL_EXECUTED, taskId: linkedTaskId, payload: { toolName: tc.toolName, message: resultSummary, level: 'success' } });
          return success({ executed: true, resultSummary, evidenceIds, linkedTaskId, linkedOperationPlanId });
        } catch (e) {
          await voiceToolCalls.updateOne({ toolCallId: tc.toolCallId }, { $set: { status: 'failed', resultSummary: e instanceof Error ? e.message : 'failed' } });
          return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'voice tool execution failed'));
        }
      });

      // Decide a voice permission. Gated actions create an operation plan to approve on Overview (visible UI) — never voice-only critical execution.
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/voice/permission/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideOperation', req, reply)) return reply;
        const perm = await voicePermissions.findOne({ permissionId: req.params.id });
        if (!perm) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'permission not found'));
        const role = declaredRole(req);
        const action = req.body?.action ?? '';
        if (perm.ownerOnly && action === 'approve' && role !== 'owner') {
          await writeSecEvent({ eventType: EVENT_TYPES.RBAC_DENIED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: perm.permissionId, result: 'denied', riskLevel: 'high', detail: 'voice permission requires owner' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'this action requires OWNER approval on the Overview UI'));
        }
        const tc = await voiceToolCalls.findOne({ toolCallId: perm.toolCallId });
        if (action !== 'approve') {
          await voicePermissions.updateOne({ permissionId: perm.permissionId }, { $set: { status: 'rejected', approvedBy: role, decidedAt: nowIso() } });
          if (tc) await voiceToolCalls.updateOne({ toolCallId: tc.toolCallId }, { $set: { status: 'rejected' } });
          return success({ status: 'rejected' });
        }
        // Approve → create the operation plan and hand off to the Overview UI (no direct critical execution by voice).
        let operationPlanId: string | null = null;
        if (tc && tc.toolName === 'create_operation_plan') {
          const a = tc.proposedArgs as { operationType?: string; targetService?: string };
          const plan = buildOperationPlan({ goal: tc.proposedArgs.goal as string ?? `Operation on ${a.targetService}`, operationType: (a.operationType as 'existing_app_restart') ?? 'existing_app_restart', target: { targetService: a.targetService ?? '' } });
          await saveOp(plan); operationPlanId = plan.operationPlanId;
        }
        await voicePermissions.updateOne({ permissionId: perm.permissionId }, { $set: { status: 'approved', approvedBy: role, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'voice_permission_approved', targetType: 'voice_permission', targetId: perm.permissionId, after: { operationPlanId } });
        await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_PERMISSION_DECIDED, taskId: null, payload: { permissionId: perm.permissionId, status: 'approved', operationPlanId, message: 'Voice approval → review and execute on Overview' } });
        return success({ status: 'approved', operationPlanId, message: 'An operation plan was created — review the risk and approve it on the Overview to execute.' });
      });

      // === Phase AA — Scope, Identity & Multi-Tenant Governance ==========
      // ONE authorization engine (shared canAccess) enforced at this gateway
      // boundary. Global software evolution; scoped human data. Missing scope
      // fails closed; denials are recorded as access_decisions + security
      // events. The legacy env-based owner login keeps working: it resolves
      // to user_esan in tenant_esan_personal via legacyRoleToAuthContext.
      const tenantsCol = collection<Tenant>(COLLECTIONS.TENANTS);
      const userProfiles = collection<UserProfile>(COLLECTIONS.USER_PROFILES);
      const memberships = collection<TenantMembership>(COLLECTIONS.TENANT_MEMBERSHIPS);
      const consentGrants = collection<ConsentGrant>(COLLECTIONS.CONSENT_GRANTS);
      const connectorAccounts = collection<ConnectorAccount>(COLLECTIONS.CONNECTOR_ACCOUNTS);
      const connectorSyncRuns = collection<ConnectorSyncRun>(COLLECTIONS.CONNECTOR_SYNC_RUNS);
      const scopedMemories = collection<ScopedMemory>(COLLECTIONS.SCOPED_MEMORIES);
      const userGoals = collection<UserGoal>(COLLECTIONS.USER_GOALS);
      const dailyBriefings = collection<DailyBriefing>(COLLECTIONS.DAILY_BRIEFINGS);
      const opportunityReports = collection<OpportunityReport>(COLLECTIONS.OPPORTUNITY_REPORTS);
      const accessDecisions = collection<AccessDecision>(COLLECTIONS.ACCESS_DECISIONS);

      // Idempotent bootstrap: Esan is the first owner and platform governor.
      void (async () => {
        const seed = buildEsanSeed();
        const seeded = await tenantsCol.updateOne({ tenantId: seed.tenant.tenantId }, { $setOnInsert: seed.tenant }, { upsert: true });
        await userProfiles.updateOne({ userId: seed.user.userId }, { $setOnInsert: seed.user }, { upsert: true });
        await memberships.updateOne({ membershipId: seed.membership.membershipId }, { $setOnInsert: seed.membership }, { upsert: true });
        if (seeded.upsertedCount > 0) await ctx.publisher.publish({ type: EVENT_TYPES.IDENTITY_SEEDED, taskId: null, payload: { tenantId: ESAN_TENANT_ID, userId: ESAN_USER_ID, message: 'Esan seeded as owner and platform governor' } });
      })().catch(() => undefined);

      const resolveAuth = (req: Req): AuthContext => legacyRoleToAuthContext(declaredRole(req));

      /** Enforce a scoped access request. Denials/approval-required are
       *  recorded (access_decisions + security event) and answered 403. */
      const enforceScoped = async (req: Req, reply: FastifyReplyLike, access: Omit<AccessRequest, 'actor'>): Promise<AuthContext | null> => {
        const actor = resolveAuth(req);
        const verdict = canAccess({ actor, ...access });
        if (!verdict.allowed) {
          await accessDecisions.insertOne(buildAccessDecision({ actor, ...access }, verdict));
          await writeSecEvent({ eventType: verdict.decision === 'approval_required' ? EVENT_TYPES.ACCESS_APPROVAL_REQUIRED : EVENT_TYPES.ACCESS_DENIED, actorId: actor.actorId, role: actor.roles[0] ?? 'unknown', ip: clientIp(req), userAgent: userAgent(req), target: access.resource, result: 'denied', riskLevel: 'medium', detail: verdict.reason });
          reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, verdict.reason, { decision: verdict.decision, requiredApproval: verdict.requiredApproval }));
          return null;
        }
        if (verdict.auditRequired) await accessDecisions.insertOne(buildAccessDecision({ actor, ...access }, verdict));
        return actor;
      };

      // --- personal operating layer (user scope, fail closed) -------------
      app.get('/v1/me/context', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'me_context', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const [profile, tenant, goals, consents, safe] = await Promise.all([
          userProfiles.findOne({ userId: actor.primaryUserId }, { projection: { _id: 0 } }),
          tenantsCol.findOne({ tenantId: actor.activeTenantId }, { projection: { _id: 0 } }),
          userGoals.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'active' }),
          consentGrants.countDocuments({ userId: actor.primaryUserId ?? '', status: 'active' }),
          isSafeMode(),
        ]);
        return success({
          actor: { actorId: actor.actorId, actorType: actor.actorType, displayName: profile?.displayName ?? 'Esan', roles: actor.roles, isOwner: actor.isOwner },
          tenant: tenant ? { tenantId: tenant.tenantId, name: tenant.name, kind: tenant.kind } : null,
          activeScope: 'user', safeMode: safe, activeGoals: goals, activeConsents: consents,
          governance: 'Global software evolution. Scoped human data.',
        });
      });
      app.get('/v1/me/profile', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'user_profile', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await userProfiles.findOne({ userId: actor.primaryUserId }, { projection: { _id: 0 } }));
      });
      app.patch<{ Body: { displayName?: string; locale?: string; timezone?: string; preferences?: Record<string, unknown> } }>('/v1/me/profile', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'user_profile', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const upd: Record<string, unknown> = { updatedAt: nowIso() };
        if (req.body?.displayName) upd.displayName = String(req.body.displayName).slice(0, 80);
        if (req.body?.locale) upd.locale = String(req.body.locale).slice(0, 10);
        if (req.body?.timezone) upd.timezone = String(req.body.timezone).slice(0, 60);
        if (req.body?.preferences) upd.preferences = req.body.preferences;
        await userProfiles.updateOne({ userId: actor.primaryUserId }, { $set: upd });
        return success({ updated: true });
      });
      app.get('/v1/me/goals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'user_goals', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await userGoals.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { title?: string; description?: string; horizon?: string; priority?: string } }>('/v1/me/goals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'user_goals', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const title = String(req.body?.title ?? '').trim();
        if (!title) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'title is required'));
        const stamp = stampScope(actor, 'user');
        const goal: UserGoal = { ...stamp, goalId: genId('goal'), title: title.slice(0, 160), description: String(req.body?.description ?? '').slice(0, 1000), horizon: (['day', 'week', 'month', 'quarter', 'year', 'life'].includes(String(req.body?.horizon)) ? req.body?.horizon : 'week') as UserGoal['horizon'], status: 'active', priority: (['low', 'normal', 'high'].includes(String(req.body?.priority)) ? req.body?.priority : 'normal') as UserGoal['priority'], createdAt: nowIso(), updatedAt: nowIso() };
        await userGoals.insertOne(goal);
        return success(goal);
      });
      app.get('/v1/me/memories', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'scoped_memories', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await scopedMemories.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { kind?: string; content?: string } }>('/v1/me/memories', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'scoped_memories', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const content = String(req.body?.content ?? '').trim();
        if (!content) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'content is required'));
        const stamp = stampScope(actor, 'user');
        const mem: ScopedMemory = { ...stamp, memoryId: genId('smem'), kind: (['preference', 'fact', 'decision', 'workflow', 'mistake_avoidance', 'inference'].includes(String(req.body?.kind)) ? req.body?.kind : 'fact') as ScopedMemory['kind'], content: content.slice(0, 2000), source: 'user', confidence: 1, consentGrantId: null, createdAt: nowIso(), updatedAt: nowIso() };
        await scopedMemories.insertOne(mem);
        await ctx.publisher.publish({ type: EVENT_TYPES.SCOPED_MEMORY_WRITTEN, taskId: null, payload: { scope: 'user', message: 'Private user memory written (content not included in event)' } });
        return success(mem);
      });
      app.get('/v1/me/briefings', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'daily_briefings', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await dailyBriefings.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(14).toArray());
      });
      app.get('/v1/me/opportunities', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'opportunity_reports', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await opportunityReports.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray());
      });
      app.get('/v1/tenants/current', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'tenant', scope: 'tenant', tenantId: resolveAuth(req).activeTenantId ?? null });
        if (!actor) return reply;
        const [tenant, members] = await Promise.all([
          tenantsCol.findOne({ tenantId: actor.activeTenantId }, { projection: { _id: 0 } }),
          memberships.find({ tenantId: actor.activeTenantId ?? '' }, { projection: { _id: 0 } }).limit(50).toArray(),
        ]);
        return success({ tenant, members });
      });

      // --- consent & connector foundation (read-only, no secrets) ---------
      app.get('/v1/consents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await consentGrants.find({ userId: actor.primaryUserId ?? '' }, { projection: { _id: 0 } }).sort({ grantedAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { connectorType?: string; scopesAllowed?: string[] } }>('/v1/consents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const connectorType = String(req.body?.connectorType ?? '').trim().slice(0, 40);
        if (!connectorType) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'connectorType is required'));
        // Phase AA: consent is READ-ONLY by design. Write modes come later,
        // behind preview + approval + audit + evidence.
        const grant: ConsentGrant = { grantId: genId('consent'), tenantId: actor.activeTenantId ?? ESAN_TENANT_ID, userId: actor.primaryUserId ?? ESAN_USER_ID, connectorType, scopesAllowed: (req.body?.scopesAllowed ?? []).map(String).slice(0, 20), accessMode: 'read_only', status: 'active', grantedAt: nowIso(), expiresAt: null, revokedAt: null, createdBy: actor.actorId, auditContext: { via: 'gateway' } };
        await consentGrants.insertOne(grant);
        await writeAudit({ actorType: 'human', actorId: actor.actorId, role: declaredRole(req), action: 'consent_granted', targetType: 'consent_grant', targetId: grant.grantId, after: { connectorType, accessMode: grant.accessMode } });
        await ctx.publisher.publish({ type: EVENT_TYPES.CONSENT_GRANTED, taskId: null, payload: { grantId: grant.grantId, connectorType, accessMode: grant.accessMode, message: `Read-only consent granted for ${connectorType}` } });
        return success(grant);
      });
      app.post<{ Params: { id: string } }>('/v1/consents/:id/revoke', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const grant = await consentGrants.findOne({ grantId: req.params.id, userId: actor.primaryUserId ?? '' });
        if (!grant) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'consent grant not found in your scope'));
        await consentGrants.updateOne({ grantId: grant.grantId }, { $set: { status: 'revoked', revokedAt: nowIso() } });
        await connectorAccounts.updateMany({ consentGrantId: grant.grantId }, { $set: { status: 'blocked', error: 'consent revoked', updatedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: actor.actorId, role: declaredRole(req), action: 'consent_revoked', targetType: 'consent_grant', targetId: grant.grantId });
        await ctx.publisher.publish({ type: EVENT_TYPES.CONSENT_REVOKED, taskId: null, payload: { grantId: grant.grantId, connectorType: grant.connectorType, message: `Consent revoked for ${grant.connectorType} — future syncs blocked` } });
        return success({ revoked: true });
      });
      app.get('/v1/connectors', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'connector_accounts', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await connectorAccounts.find({ userId: actor.primaryUserId ?? '' }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { connectorType?: string; provider?: string; consentGrantId?: string } }>('/v1/connectors', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const auth = resolveAuth(req);
        const grant = await consentGrants.findOne({ grantId: String(req.body?.consentGrantId ?? ''), userId: auth.primaryUserId ?? '' });
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'connector_accounts', scope: 'user', userId: auth.primaryUserId ?? null, requiresConsent: true, consentStatus: (grant?.status as 'active' | 'revoked' | 'expired' | undefined) ?? 'missing' });
        if (!actor) return reply;
        const account: ConnectorAccount = { connectorAccountId: genId('conn'), tenantId: actor.activeTenantId ?? ESAN_TENANT_ID, userId: actor.primaryUserId ?? ESAN_USER_ID, connectorType: String(req.body?.connectorType ?? grant?.connectorType ?? '').slice(0, 40), provider: String(req.body?.provider ?? '').slice(0, 40), status: 'pending', scopes: grant?.scopesAllowed ?? [], consentGrantId: grant?.grantId ?? '', lastSyncAt: null, error: '', metadata: {}, createdAt: nowIso(), updatedAt: nowIso() };
        await connectorAccounts.insertOne(account);
        return success(account);
      });
      app.post<{ Params: { id: string } }>('/v1/connectors/:id/sync', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const auth = resolveAuth(req);
        const account = await connectorAccounts.findOne({ connectorAccountId: req.params.id, userId: auth.primaryUserId ?? '' });
        if (!account) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'connector account not found in your scope'));
        const grant = await consentGrants.findOne({ grantId: account.consentGrantId });
        const consentActive = grant?.status === 'active';
        const run: ConnectorSyncRun = {
          syncRunId: genId('sync'), connectorAccountId: account.connectorAccountId, tenantId: account.tenantId, userId: account.userId,
          status: !consentActive ? 'blocked_no_consent' : 'not_configured',
          itemsRead: 0,
          detail: !consentActive ? `consent ${grant?.status ?? 'missing'} — sync refused` : `${account.connectorType} provider integration not configured yet (Phase AA is foundation-only; read-only sync arrives with the connector phase)`,
          startedAt: nowIso(), finishedAt: nowIso(),
        };
        await connectorSyncRuns.insertOne(run);
        if (!consentActive) {
          await ctx.publisher.publish({ type: EVENT_TYPES.CONNECTOR_SYNC_BLOCKED, taskId: null, payload: { connectorAccountId: account.connectorAccountId, message: `Sync blocked: consent ${grant?.status ?? 'missing'}`, level: 'warn' } });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'consent is not active — sync blocked', { syncRunId: run.syncRunId }));
        }
        return success(run);
      });
      // === Phase AB — Personal Reality Baseline & Jarvis layer ============
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
      const personalHealthStates = collection<PersonalHealthState>(COLLECTIONS.PERSONAL_HEALTH_STATES);
      const personalLifeItems = collection<PersonalLifeItem>(COLLECTIONS.PERSONAL_LIFE_ITEMS);
      const personalFinanceItems = collection<PersonalFinanceItem>(COLLECTIONS.PERSONAL_FINANCE_ITEMS);
      const personalLearningTracks = collection<PersonalLearningTrack>(COLLECTIONS.PERSONAL_LEARNING_TRACKS);
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

      // Ingestion: manual/user-provided data with source + confidence stamped.
      app.post<{ Body: { kind?: string; data?: Record<string, unknown> } }>('/v1/me/reality/ingest', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'personal_reality', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const kind = String(req.body?.kind ?? '') as IngestionKind;
        if (!INGESTION_KINDS.includes(kind)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, `kind must be one of: ${INGESTION_KINDS.join(', ')}`));
        const d = req.body?.data ?? {};
        const stamp = userStamp(actor);
        const now = nowIso();
        const meta = { ...stamp, source: `ingestion:${kind}`, confidence: 0.9, freshness: now, createdAt: now, updatedAt: now };
        let created = 0, updated = 0;
        const str = (k: string, max = 500): string => String((d as Record<string, unknown>)[k] ?? '').slice(0, max);
        const arr = (k: string): string[] => (Array.isArray((d as Record<string, unknown>)[k]) ? ((d as Record<string, unknown>)[k] as unknown[]).map(String).slice(0, 40) : []);
        try {
          if (kind === 'profile') {
            const existing = await realityProfiles.findOne({ scope: 'user', userId: actor.primaryUserId });
            if (existing) { await realityProfiles.updateOne({ profileId: existing.profileId }, { $set: { displayName: str('displayName', 80) || existing.displayName, headline: str('headline', 200) || existing.headline, summary: str('summary', 2000) || existing.summary, location: str('location', 100) || existing.location, focusAreas: arr('focusAreas').length ? arr('focusAreas') : existing.focusAreas, strengths: arr('strengths').length ? arr('strengths') : existing.strengths, currentPosition: str('currentPosition', 200) || existing.currentPosition, incomeDirection: str('incomeDirection', 500) || existing.incomeDirection, scheduleDirection: str('scheduleDirection', 500) || existing.scheduleDirection, learningDirection: str('learningDirection', 500) || existing.learningDirection, freshness: now, updatedAt: now } }); updated++; }
            else { await realityProfiles.insertOne({ ...meta, recordKind: 'fact', profileId: genId('prof'), displayName: str('displayName', 80), headline: str('headline', 200), summary: str('summary', 2000), location: str('location', 100), focusAreas: arr('focusAreas'), strengths: arr('strengths'), currentPosition: str('currentPosition', 200), incomeDirection: str('incomeDirection', 500), scheduleDirection: str('scheduleDirection', 500), learningDirection: str('learningDirection', 500) }); created++; }
          } else if (kind === 'project') { await personalProjects.insertOne({ ...meta, recordKind: 'fact', projectId: genId('pproj'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), incomePotential: (['none', 'low', 'medium', 'high', 'unknown'].includes(str('incomePotential')) ? str('incomePotential') : 'unknown') as PersonalProject['incomePotential'], linkedGoalIds: arr('linkedGoalIds') }); created++; }
          else if (kind === 'system') { await personalSystems.insertOne({ ...meta, recordKind: 'fact', systemId: genId('psys'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), systemType: (['software', 'automation', 'process', 'habit', 'aos_service', 'other'].includes(str('systemType')) ? str('systemType') : 'other') as PersonalSystem['systemType'] }); created++; }
          else if (kind === 'asset') { await personalAssets.insertOne({ ...meta, recordKind: 'fact', assetId: genId('passet'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), assetType: (['skill', 'software', 'content', 'audience', 'infrastructure', 'financial', 'credential', 'other'].includes(str('assetType')) ? str('assetType') : 'other') as PersonalAsset['assetType'] }); created++; }
          else if (kind === 'risk') { await personalRisks.insertOne({ ...meta, recordKind: 'fact', riskId: genId('prisk'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: [], severity: (['low', 'medium', 'high', 'critical'].includes(str('severity')) ? str('severity') : 'medium') as PersonalRisk['severity'], mitigation: str('mitigation', 500) }); created++; }
          else if (kind === 'income_idea') { await personalIncomeStreams.insertOne({ ...meta, recordKind: 'fact', incomeStreamId: genId('pinc'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: [], streamType: (['salary', 'freelance', 'product', 'saas', 'content', 'investment', 'idea', 'other'].includes(str('streamType')) ? str('streamType') : 'idea') as PersonalIncomeStream['streamType'], monthlyEstimate: typeof (d as Record<string, unknown>).monthlyEstimate === 'number' ? (d as { monthlyEstimate: number }).monthlyEstimate : null }); created++; }
          else if (kind === 'goal') { const g = { ...userStamp(actor), goalId: genId('goal'), title: str('title', 160), description: str('description', 1000), horizon: 'week' as const, status: 'active' as const, priority: 'normal' as const, createdAt: now, updatedAt: now }; if (!g.title) throw new Error('title required'); await userGoals.insertOne(g); created++; }
          else if (kind === 'health_state') {
            const level = typeof (d as Record<string, unknown>).level === 'number' ? Math.max(0, Math.min(10, (d as { level: number }).level)) : null;
            await personalHealthStates.insertOne({ ...meta, recordKind: 'fact', healthStateId: genId('phlth'), metric: (['wellbeing', 'energy', 'sleep', 'stress', 'weight', 'activity', 'nutrition', 'symptom', 'habit'].includes(str('metric')) ? str('metric') : 'wellbeing') as PersonalHealthState['metric'], level, value: str('value', 60), note: str('note', 400), concern: Boolean((d as Record<string, unknown>).concern) }); created++;
          }
          else if (kind === 'life_item') {
            await personalLifeItems.insertOne({ ...meta, recordKind: 'fact', lifeItemId: genId('plife'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), domain: (['family', 'home', 'relationship', 'household', 'personal'].includes(str('domain')) ? str('domain') : 'personal') as PersonalLifeItem['domain'], itemType: (['responsibility', 'concern', 'event', 'task', 'note'].includes(str('itemType')) ? str('itemType') : 'responsibility') as PersonalLifeItem['itemType'], dueDate: str('dueDate', 10) || null, importance: (['low', 'normal', 'high'].includes(str('importance')) ? str('importance') : 'normal') as PersonalLifeItem['importance'] }); created++;
          }
          else if (kind === 'finance_item') {
            await personalFinanceItems.insertOne({ ...meta, recordKind: 'fact', financeItemId: genId('pfin'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), itemType: (['income', 'expense', 'bill', 'installment', 'obligation', 'investment', 'purchase', 'sale'].includes(str('itemType')) ? str('itemType') : 'expense') as PersonalFinanceItem['itemType'], amount: typeof (d as Record<string, unknown>).amount === 'number' ? (d as { amount: number }).amount : null, currency: str('currency', 8), cadence: (['once', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(str('cadence')) ? str('cadence') : 'monthly') as PersonalFinanceItem['cadence'], dueDate: str('dueDate', 10) || null }); created++;
          }
          else if (kind === 'learning_track') {
            await personalLearningTracks.insertOne({ ...meta, recordKind: 'fact', learningTrackId: genId('plearn'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), targetSkill: str('targetSkill', 120), linkedGoalIds: arr('linkedGoalIds') }); created++;
          }
          else if (kind === 'career_record') { await personalCareerRecords.insertOne({ ...meta, recordKind: 'fact', careerRecordId: genId('pcar'), kind: (['experience', 'education', 'achievement', 'certification'].includes(str('recordType')) ? str('recordType') : 'experience') as PersonalCareerRecord['kind'], title: str('title', 160), organization: str('organization', 160), period: str('period', 60), details: str('details', 2000) }); created++; }
          else if (kind === 'resume') {
            const existing = await resumeProfiles.findOne({ scope: 'user', userId: actor.primaryUserId });
            const base = { rawText: str('rawText', 20000), skills: arr('skills'), freshness: now, updatedAt: now };
            if (existing) { await resumeProfiles.updateOne({ resumeProfileId: existing.resumeProfileId }, { $set: base }); updated++; }
            else { await resumeProfiles.insertOne({ ...meta, recordKind: 'fact', resumeProfileId: genId('presume'), ...base, positioning: '', verifiedFacts: [], userClaims: [], modelInferences: [], suggestions: [] }); created++; }
          } else { return reply.code(400).send(failure(ERROR_CODES.VALIDATION, `${kind} ingestion accepts only the documented fields`)); }
        } catch (e) { return reply.code(400).send(failure(ERROR_CODES.VALIDATION, e instanceof Error ? e.message : 'ingestion failed')); }
        const graph = buildPersonalGraph(await loadGraphInput(actor));
        const result: IngestionResult = { source: `ingestion:${kind}`, kind, recordsCreated: created, recordsUpdated: updated, confidence: 0.9, missingData: graph.missingData, nextSuggestedConnector: nextConnectorFor(kind) };
        const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: null, summary: `Personal ingestion ${kind}: +${created}/${updated} updated (user scope)`, data: { kind, created, updated } });
        await evidenceCol.insertOne(ev);
        return success({ ...result, evidenceId: ev.evidenceId });
      });

      const realityGet = (path: string, fetcher: (actor: AuthContext) => Promise<unknown>) => {
        app.get(path, async (req, reply) => {
          if (!guard(req)) return deny(reply);
          const actor = await enforceScoped(req, reply, { action: 'read', resource: path, scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
          if (!actor) return reply;
          return success(await fetcher(actor));
        });
      };
      realityGet('/v1/me/reality/profile', async (actor) => {
        const input = await loadGraphInput(actor);
        return { profile: input.profile, graph: buildPersonalGraph(input) };
      });
      realityGet('/v1/me/reality/goals', async (actor) => userGoals.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      realityGet('/v1/me/reality/projects', async (actor) => ({
        projects: await personalProjects.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
        systems: await personalSystems.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
        assets: await personalAssets.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(100).toArray(),
      }));
      realityGet('/v1/me/reality/opportunities', async (actor) => rankOpportunities(await personalOpportunities.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(100).toArray()));
      realityGet('/v1/me/reality/risks', async (actor) => personalRisks.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray());
      realityGet('/v1/me/reality/next-actions', async (actor) => {
        const ranked = scoreNextActions(await loadGraphInput(actor), userStamp(actor));
        // Persist fresh proposals (idempotent enough: superseded ones expire).
        if (ranked.length) await nextBestActions.insertMany(ranked.map((a) => ({ ...a })));
        return ranked;
      });

      // Phase AC+ — THE Command Universe contract: one scope-enforced fetch
      // for the entire living home surface (9 zones, honest statuses).
      realityGet('/v1/me/universe', async (actor) => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [graph, health, life, finance, learning, nbas, briefing, connectors, svcCount, inc, op, activeSession, recentEvents, safe, memRecent] = await Promise.all([
          loadGraphInput(actor),
          personalHealthStates.find(uFilter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
          personalLifeItems.find(uFilter, { projection: { _id: 0 } }).limit(100).toArray(),
          personalFinanceItems.find(uFilter, { projection: { _id: 0 } }).limit(200).toArray(),
          personalLearningTracks.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray(),
          nextBestActions.find({ ...uFilter, status: 'proposed' }, { projection: { _id: 0 } }).sort({ priorityScore: -1 }).limit(10).toArray(),
          personalBriefingRuns.find(uFilter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray(),
          connectorAccounts.find({ userId: uid }, { projection: { _id: 0 } }).limit(50).toArray(),
          (async () => { try { const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(3000) }); const b = (await r.json()) as { data?: unknown[] }; return Array.isArray(b.data) ? b.data.length : 0; } catch { return 0; } })(),
          incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(),
          operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
          opSessions.find({ status: { $in: ['planning', 'running', 'waiting_approval', 'verifying'] } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).toArray(),
          events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(5).toArray(),
          isSafeMode(),
          scopedMemories.find({ scope: 'user', userId: uid }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(3).toArray(),
        ]);
        const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
        const openIncidentsList = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
        const zones = buildUniverseZones({
          graph, healthStates: health, lifeItems: life, financeItems: finance,
          learningTracks: learning.map((t) => ({ title: t.title, targetSkill: t.targetSkill, status: t.status })),
          nextActions: nbas, latestBriefing: briefing[0] ?? null,
          kernel: {
            services: svcCount,
            openIncidents: openIncidentsList.length,
            pendingApprovals: graph.pendingApprovals, safeMode: safe,
            activeOperation: activeOp ? `${activeOp.goal} (${activeOp.status})` : null,
            activeRuntimeGoal: activeSession[0]?.goal ?? null,
            recentEvents: recentEvents.map((e) => (e.payload as { message?: string })?.message ?? e.type),
          },
          connectors: connectors.map((c) => ({ connectorType: c.connectorType, status: c.status })),
        });

        // Phase AD — Jarvis-suggested prompts + a one-line honest summary,
        // derived only from the real zones/facts above (attention first, then
        // setup-ready, then live) — never decorative, never invented.
        const priorityOrder: Record<string, number> = { attention: 0, setup_needed: 1, live: 2, not_configured: 3 };
        const suggestedPrompts = [...zones]
          .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9))
          .map((z) => z.jarvisCommand)
          .filter((c, i, arr) => c && arr.indexOf(c) === i)
          .slice(0, 4);
        const topAction = nbas[0];
        const todaySummary = topAction
          ? `Top priority: ${topAction.title}.${graph.pendingApprovals ? ` ${graph.pendingApprovals} approval(s) waiting.` : ''}${openIncidentsList.length ? ` ${openIncidentsList.length} open incident(s).` : ''}`
          : `No ranked priorities yet — build your baseline or tell Jarvis a goal.${graph.pendingApprovals ? ` ${graph.pendingApprovals} approval(s) waiting.` : ''}`;
        const systemHealthSummary = {
          servicesRegistered: svcCount,
          openIncidents: openIncidentsList.length,
          pendingApprovals: graph.pendingApprovals,
          safeMode: safe,
          activeOperation: activeOp ? `${activeOp.goal} (${activeOp.status})` : null,
        };
        const memoryInsights = memRecent.map((m) => m.content);

        return { zones, actor: { displayName: graph.profile?.displayName || 'Esan' }, generatedAt: nowIso(), suggestedPrompts, todaySummary, systemHealthSummary, memoryInsights };
      });

      // Phase AE item 7 — the daily command briefing: ranked priorities across
      // kernel tasks + personal projects + next-best-actions, recent decisions,
      // active blockers, composed into one grounded narrative. Real records
      // only (same discipline as /v1/me/universe) — nothing here is invented.
      realityGet('/v1/jarvis/briefing', async (actor) => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [graph, activeTasks, activeProjects, recentDecisions, recentMemoryFacts, nbas, openIncidentsRaw, safe] = await Promise.all([
          loadGraphInput(actor),
          tasks.find({ status: { $in: ['queued', 'planning', 'awaiting_approval', 'in_progress', 'blocked'] } }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(20).toArray(),
          personalProjects.find({ ...uFilter, status: 'active' }, { projection: { _id: 0 } }).limit(20).toArray(),
          decisionMemories.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray(),
          jarvisMemoryFacts.find({ actorId: actor.actorId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
          nextBestActions.find({ ...uFilter, status: 'proposed' }, { projection: { _id: 0 } }).sort({ priorityScore: -1 }).limit(10).toArray(),
          incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(),
          isSafeMode(),
        ]);
        const openIncidentsList = openIncidentsRaw.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
        const brainInput: DailyBrainInput = {
          actorName: graph.profile?.displayName || 'Esan',
          scope: 'user',
          activeTasks: activeTasks.map((t) => ({ taskId: t.taskId, goal: t.goal, status: t.status, priority: t.priority, createdAt: t.createdAt })),
          activeProjects: activeProjects.map((p) => ({ projectId: p.projectId, title: p.title, incomePotential: p.incomePotential, status: p.status })),
          pendingApprovals: graph.pendingApprovals,
          openIncidents: openIncidentsList.map((i) => ({ incidentId: i.incidentId, title: i.title, severity: i.severity })),
          personalRisks: (await personalRisks.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray()).map((r) => ({ riskId: r.riskId, title: r.title, severity: r.severity, mitigation: r.mitigation })),
          recentDecisions: recentDecisions.map((d) => ({ decisionId: d.decisionId, goal: d.goal, selectedReason: d.selectedReason, createdAt: d.createdAt })),
          recentMemoryFacts: recentMemoryFacts.map((f) => ({ kind: f.kind, content: f.content, createdAt: f.createdAt })),
          nextBestActions: nbas.map((a) => ({ title: a.title, reason: a.reason, priorityScore: a.priorityScore })),
          safeMode: safe,
        };
        const packet = buildDailyBrainPacket(brainInput);
        const lang = detectLanguage(`${brainInput.activeTasks.map((t) => t.goal).join(' ')} ${recentMemoryFacts.map((f) => f.content).join(' ')}`);
        const forceFallback = safe && jarvisGov.safeModeFallback;
        const { data: briefing } = await composeDailyBriefing(jarvisRouter, { packet, language: lang, taskId: null, forceFallback });
        const record = {
          briefingId: genId('jbrief'), actorId: actor.actorId, scope: 'user' as const,
          headline: briefing.headline, narrative: briefing.narrative, topPriorities: briefing.topPriorities,
          decisions: briefing.decisions, blockers: briefing.blockers, suggestedFollowUps: briefing.suggestedFollowUps,
          language: briefing.language, createdAt: nowIso(),
        };
        await jarvisBriefings.insertOne(record);

        // Phase AE.1 — structured sections so the primary priority can never
        // be silently displaced by prioritizedItems (which ranks kernel
        // tasks/projects/actions, NOT explicit memory facts). An explicit,
        // recently-stated priority/decision memory fact always wins here,
        // exactly like the direct-answer path in gatherJarvisFacts.
        const priorityFact = pickActivePriorityFact(recentMemoryFacts);
        const primaryPriority = priorityFact?.content || packet.prioritizedItems[0]?.label || briefing.topPriorities[0] || '';
        const systemWarnings = openIncidentsList.map((i) => `${i.title} (${i.severity})`);
        const recommendedNextActions = briefing.suggestedFollowUps.length ? briefing.suggestedFollowUps : packet.prioritizedItems.slice(0, 3).map((p) => p.label);
        const memoryFactsUsed = recentMemoryFacts.slice(0, 10).map((f) => ({ kind: f.kind, content: f.content, importance: f.importance, createdAt: f.createdAt }));
        const confidence = priorityFact ? priorityFact.confidence : packet.prioritizedItems.length ? 0.5 : 0.3;

        return {
          ...record,
          primaryPriority,
          activeBlockers: packet.blockers,
          systemWarnings,
          recommendedNextActions,
          memoryFactsUsed,
          confidence,
          dataFreshness: packet.generatedAt,
          prioritizedItems: packet.prioritizedItems,
          generatedAt: packet.generatedAt,
        };
      });

      realityGet('/v1/me/reality/briefings', async (actor) => personalBriefingRuns.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(14).toArray());
      realityGet('/v1/me/reality/strategies', async (actor) => strategyReviewRuns.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray());
      realityGet('/v1/me/reality/resume', async (actor) => ({
        resume: await resumeProfiles.findOne({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }),
        careerRecords: await personalCareerRecords.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
      }));

      app.post<{ Body: { type?: string } }>('/v1/me/reality/review', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'personal_review', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const input = await loadGraphInput(actor);
        const sources = { calendar: input.activeConsents.includes('calendar'), email: input.activeConsents.includes('email'), tasksConnector: input.activeConsents.includes('tasks') };
        if (String(req.body?.type) === 'weekly') {
          const [completed, missed, newOpps] = await Promise.all([
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'completed' }),
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'expired' }),
            personalOpportunities.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'proposed' }),
          ]);
          const run = buildWeeklyStrategyRun({ ...input, completedActions: completed, missedActions: missed, newOpportunities: newOpps }, userStamp(actor));
          await strategyReviewRuns.insertOne(run);
          return success(run);
        }
        const aosSuggestion = buildPersonalGraph(input).missingData.length > 0
          ? `AOS should build next: automated ingestion for “${buildPersonalGraph(input).missingData[0]}” — the biggest current intelligence gap.`
          : 'AOS should build next: the read-only calendar connector (first real external signal).';
        const run = buildDailyBriefingRun(input, sources, aosSuggestion, userStamp(actor));
        await personalBriefingRuns.insertOne(run);
        return success(run);
      });

      // Decisions on recommendations → scoped learning memory.
      app.post<{ Params: { id: string }; Body: { action?: string } }>('/v1/me/reality/next-actions/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'next_best_actions', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const act = String(req.body?.action ?? '');
        if (!['accept', 'reject', 'complete'].includes(act)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'action must be accept|reject|complete'));
        const nba = await nextBestActions.findOne({ actionId: req.params.id, scope: 'user', userId: actor.primaryUserId });
        if (!nba) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'action not found in your scope'));
        const status = act === 'accept' ? 'accepted' : act === 'reject' ? 'rejected' : 'completed';
        await nextBestActions.updateOne({ actionId: nba.actionId }, { $set: { status, updatedAt: nowIso() } });
        // Learn from the decision — scoped to the user, kind by outcome.
        const stamp = userStamp(actor);
        await scopedMemories.insertOne({ ...stamp, memoryId: genId('smem'), kind: act === 'reject' ? 'mistake_avoidance' : 'decision', content: `${status.toUpperCase()}: “${nba.title}” (${nba.category}, score ${nba.priorityScore}). ${act === 'reject' ? 'Deprioritize similar suggestions.' : 'Similar suggestions are valuable.'}`, source: 'user_decision', confidence: 1, consentGrantId: null, createdAt: nowIso(), updatedAt: nowIso() });
        return success({ status });
      });

      app.get('/v1/access-decisions', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = resolveAuth(req);
        // Owners/platform roles see the platform access log; others see their own decisions.
        const filter = actor.isOwner || actor.roles.includes('platform_admin') ? {} : { actorId: actor.actorId };
        return success(await accessDecisions.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });

      // === Phase X — Autonomous Operator Runtime =========================
      // The real agent loop: goal → plan → tools → observe → approve → verify
      // → evidence → memory. Raw model output never executes a tool; only the
      // deterministic planner and explicit human approvals do.
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
        const dokploy = dokployClient ? (lastDokploySyncAt ? `synced ${lastDokploySyncAt}` : 'connected, not yet synced') : 'not configured';
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
      const gatherJarvisFacts = async (authCtx: AuthContext, scopeClass: ReturnType<typeof classifyGoalScope>, intentCategory: string): Promise<JarvisContextFact[]> => {
        const facts: JarvisContextFact[] = [];
        const safeNow = await isSafeMode();
        facts.push({ label: 'safe_mode', detail: safeNow ? 'ON — mutations are blocked' : 'off', status: 'known', weight: safeNow ? 9 : 2 });

        // Phase AE.1 — ALWAYS retrieve the owner's own stated priority/decision/
        // blocker memory FIRST, regardless of intent category. This is the fix
        // for the root bug found in the real conversation: memory facts were
        // extracted and persisted but never read back into context, so every
        // answer fell back to raw system-health facts. Weights here (20/12/11)
        // are deliberately higher than anything system health can produce below
        // (max ~10) — an explicit stated priority must outrank a routine
        // unhealthy-service warning, never the other way around.
        try {
          const recentMemFacts = await jarvisMemoryFacts.find({ actorId: authCtx.actorId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray();
          const priorityFact = pickActivePriorityFact(recentMemFacts);
          if (priorityFact) facts.push({ label: 'user_priority', detail: priorityFact.content, status: 'known', weight: 20, href: '/me' });
          for (const bf of recentMemFacts.filter((f) => f.kind === 'blocker').slice(0, 3)) {
            facts.push({ label: 'user_blocker', detail: bf.content, status: 'known', weight: 12 });
          }
          for (const df of recentMemFacts.filter((f) => f.kind === 'decision' && f.factId !== priorityFact?.factId).slice(0, 2)) {
            facts.push({ label: 'user_decision', detail: df.content, status: 'known', weight: 11 });
          }
        } catch { /* memory retrieval is best-effort — a turn never hard-fails on this */ }

        if (intentCategory === 'system_status' || intentCategory === 'general_conversation') {
          const sys = await execSystemCheck();
          const d = sys.data as { pendingApprovals?: number; openIncidents?: number } | undefined;
          facts.push({ label: 'system_check', detail: sys.summary, status: 'known', weight: 10, href: '/operations' });
          if (d) {
            facts.push({ label: 'pending_approvals', detail: String(d.pendingApprovals ?? 0), status: 'known', weight: (d.pendingApprovals ?? 0) > 0 ? 8 : 1, href: '/approvals' });
            facts.push({ label: 'open_incidents', detail: String(d.openIncidents ?? 0), status: 'known', weight: (d.openIncidents ?? 0) > 0 ? 9 : 1, href: '/incidents' });
          }
        } else {
          const [apprCount, incAll] = await Promise.all([
            approvals.countDocuments({ status: 'pending' }),
            incidents.find({}, { projection: { _id: 0 } }).limit(50).toArray(),
          ]);
          const incOpen = incAll.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
          facts.push({ label: 'pending_approvals', detail: String(apprCount), status: 'known', weight: apprCount > 0 ? 6 : 1, href: '/approvals' });
          facts.push({ label: 'open_incidents', detail: incOpen.length ? incOpen.slice(0, 2).map((i) => i.title).join('; ') : '0', status: 'known', weight: incOpen.length ? 7 : 1, href: '/incidents' });
        }

        if (scopeClass.scope === 'user') {
          try {
            const gi = await loadGraphInput(authCtx);
            const graph = buildPersonalGraph(gi);
            facts.push({ label: 'personal_missing_data', detail: graph.missingData.length ? graph.missingData.slice(0, 3).join('; ') : 'nothing critical', status: graph.missingData.length ? 'not_configured' : 'known', weight: graph.missingData.length ? 6 : 2, href: '/me' });
            const ranked = scoreNextActions(gi, userStamp(authCtx));
            const topAction = ranked[0];
            if (topAction) facts.push({ label: 'top_next_action', detail: `${topAction.title} — ${topAction.reason}`, status: 'known', weight: 9, href: '/me' });
            facts.push({ label: 'calendar_connector', detail: gi.activeConsents.includes('calendar') ? 'connected' : 'not_configured', status: gi.activeConsents.includes('calendar') ? 'known' : 'not_configured', weight: 3 });
            facts.push({ label: 'email_connector', detail: gi.activeConsents.includes('email') ? 'connected' : 'not_configured', status: gi.activeConsents.includes('email') ? 'known' : 'not_configured', weight: 3 });
          } catch { /* keep going with global facts only — a turn never hard-fails on this */ }
        }

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

        // Phase AE item 1 — memory ingestion: extract durable facts (projects,
        // priorities, decisions, blockers, preferences) from the owner's OWN
        // message text, not from Jarvis's reply. Never blocks the turn.
        try {
          const { result: extraction, usedFallback: memUsedFallback } = await extractMemoryFacts(jarvisRouter, args.text, { forceFallback: args.forceFallback, taskId: null });
          if (extraction.facts.length) {
            const memFacts = buildMemoryFacts({ turnId: turn.turnId, actorId: args.authCtx.actorId, scope: args.scopeClass.scope === 'user' ? 'user' : 'global', result: extraction, usedLlm: !memUsedFallback });
            if (memFacts.length) await jarvisMemoryFacts.insertMany(memFacts);
          }
        } catch { /* memory extraction is best-effort; never blocks the reply */ }

        // Phase AE item 5 — score this answer against the context it claims
        // to be grounded in. Stored for later inspection, never blocks the turn.
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
          lastDokploySyncAt = nowIso();
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
        research_topic: async (args) => { const id = await createKernelTask(String(args.goal ?? 'Research current best practices.'), ['research', 'operator']); return { ok: true, summary: `Research task ${id} started.`, data: { taskId: id } }; },
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
        find_opportunities: async (_args, role) => {
          const actor = legacyRoleToAuthContext(role);
          if (!actor.primaryUserId) return { ok: false, summary: 'No user identity — user scope fails closed.' };
          const opps = await personalOpportunities.find({ scope: 'user', userId: actor.primaryUserId, status: { $in: ['proposed', 'accepted', 'in_progress'] } }, { projection: { _id: 0 } }).limit(100).toArray();
          if (opps.length === 0) return { ok: true, summary: 'No opportunities recorded in your scope yet, and the research provider is not_configured — I will not invent market claims. Ingest opportunity candidates (income ideas, career options) or configure research later.' };
          const ranked = rankOpportunities(opps);
          const top = ranked[0];
          return { ok: true, summary: `Top opportunity: “${top?.title}” (${top?.category}), value ${top?.valueScore} — ${top?.reason.slice(0, 120)} [source: ${top?.source}, confidence ${top?.confidence}]. Next: ${top?.recommendedNextAction || 'define the first concrete step'}. ${ranked.length} ranked in total.`, data: { ranked: ranked.slice(0, 5) } };
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
              if (stopSessionOnFailure(tool.category)) { session.status = 'failed'; break; }
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
            session.status = 'failed'; session.nextAction = fa.nextAction;
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

      // --- endpoints -------------------------------------------------------
      app.get('/v1/operator/tools', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await liveRegistry());
      });
      app.get('/v1/operator/capabilities', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(buildCapabilityAnswer(await liveRegistry()));
      });
      app.get('/v1/operator/sessions', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await opSessions.find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(30).toArray());
      });
      app.get('/v1/operator/sessions/active', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const list = await opSessions.find({ status: { $in: ['planning', 'running', 'waiting_approval', 'waiting_user_input', 'verifying'] } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).toArray();
        return success(list[0] ?? null);
      });
      app.get<{ Params: { id: string } }>('/v1/operator/sessions/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [s, steps, runs, perms] = await Promise.all([
          opSessions.findOne({ runtimeSessionId: req.params.id }, { projection: { _id: 0 } }),
          opSteps.find({ runtimeSessionId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
          opToolRuns.find({ runtimeSessionId: req.params.id }, { projection: { _id: 0 } }).sort({ startedAt: 1 }).toArray(),
          opPermissions.find({ runtimeSessionId: req.params.id }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
        ]);
        if (!s) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'runtime session not found'));
        // Phase Z — live workspace telemetry for the console command center.
        let workspace: unknown = null;
        const wsId = (s.context as { workspaceId?: string } | undefined)?.workspaceId;
        if (wsId) {
          const r = await codeAgentTask('ws_status', { workspaceId: wsId }, 8000);
          if (r.ok) workspace = r.data;
        }
        return success({ session: s, steps, toolRuns: runs, permissions: perms, workspace });
      });
      app.get('/v1/operator/memories', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await opMemories.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });

      // In-memory duplicate-command window (same hygiene as the voice path).
      const recentCommands = new Map<string, number>();
      app.post<{ Body: { text?: string } }>('/v1/operator/command', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'operator_command')) return reply;
        const role = declaredRole(req);
        const text = String(req.body?.text ?? '').trim();
        const norm = normalizeUtterance(text);
        if (norm.length < 4) return success({ kind: 'ignored', reason: 'too_short' });
        const key = `${role}:${norm}`;
        const last = recentCommands.get(key) ?? 0;
        if (Date.now() - last < 5000) return success({ kind: 'ignored', reason: 'duplicate_within_window' });
        recentCommands.set(key, Date.now());
        if (recentCommands.size > 500) recentCommands.clear();

        const tools = await liveRegistry();
        if (isCapabilityQuestion(text)) {
          const answer = buildCapabilityAnswer(tools);
          return success({ kind: 'capabilities', ...answer });
        }

        // Phase AD — Jarvis Intelligence Core: classify intent + language
        // BEFORE any tool routing. The deterministic planner below still owns
        // every actual tool execution and approval gate — the LLM only ever
        // decides how to talk about real state and results, never what to run.
        const safe = await isSafeMode();
        const forceFallback = safe && jarvisGov.safeModeFallback;
        const { intent } = await classifyIntent(jarvisRouter, text, { forceFallback });
        const mode = decideJarvisMode(intent);

        // Phase AA — the operator is scope-aware: it knows who is asking, the
        // active tenant, and whether this is global software evolution or a
        // scoped human operation. Scopes are never mixed.
        const authCtx = legacyRoleToAuthContext(role);
        const scopeClass = classifyGoalScope(text);
        const scopeContext = { actor: authCtx.primaryUserId === ESAN_USER_ID ? 'Esan' : authCtx.actorId, scope: scopeClass.scope, mode: scopeClass.mode, tenant: authCtx.activeTenantId ?? null, reason: scopeClass.reason };

        if (mode === 'direct_answer') {
          const answer = await composeAndRecordJarvisTurn({ text, intent, authCtx, scopeClass, mode, forceFallback });
          return success({ kind: 'answer', reply: answer.reply, language: answer.language, suggestedFollowUps: answer.suggestedFollowUps, intentCategory: intent.category, scopeContext });
        }

        const planned = planForGoal(text, { safeMode: safe, role });
        if (planned.kind === 'clarify') {
          // Even when the deterministic planner has no matching tool sequence
          // (e.g. finance/calendar/email — no connector exists yet), Jarvis
          // still answers honestly from real context instead of a dead end.
          const answer = await composeAndRecordJarvisTurn({ text, intent, authCtx, scopeClass, mode: 'direct_answer', forceFallback });
          return success({ kind: 'answer', reply: answer.reply, language: answer.language, suggestedFollowUps: answer.suggestedFollowUps, intentCategory: intent.category, scopeContext });
        }

        const session: OperatorRuntimeSession = {
          runtimeSessionId: genId('osess'), userId: role, goal: text, status: 'planning', currentStep: 0,
          plan: planned.steps, toolRunIds: [], approvalIds: [], observations: [], context: { scopeMode: scopeClass.mode }, evidenceIds: [],
          reportSummary: '', memoryIds: [], nextAction: '', startedAt: nowIso(), completedAt: null,
          scope: scopeClass.scope,
          tenantId: scopeClass.scope === 'global' ? undefined : authCtx.activeTenantId,
          createdBy: authCtx.actorId,
          visibility: scopeClass.scope === 'user' ? 'private' : scopeClass.scope === 'global' ? 'public' : 'tenant',
        };
        if (scopeClass.scope === 'user') session.context.scopeUserId = authCtx.primaryUserId;
        await opSessions.insertOne(session);
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_SESSION_STARTED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, goal: text.slice(0, 120), scope: scopeClass.scope, message: `Operator session started (${scopeClass.mode}): ${planned.narration}` } });
        const done = await runLoop(session, role, tools);

        // Compose a grounded natural-language reply around the REAL pipeline
        // result instead of returning only the mechanical narration string.
        const planSummary = done.reportSummary || done.observations[done.observations.length - 1] || planned.narration;
        const answer = await composeAndRecordJarvisTurn({ text, intent, authCtx, scopeClass, mode, planSummary, forceFallback });
        return success({ kind: 'session', narration: planned.narration, reply: answer.reply, language: answer.language, suggestedFollowUps: answer.suggestedFollowUps, session: done, scopeContext });
      });

      app.post<{ Params: { id: string }; Body: { action?: string } }>('/v1/operator/permissions/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideOperation', req, reply)) return reply;
        const role = declaredRole(req);
        const perm = await opPermissions.findOne({ permissionId: req.params.id });
        if (!perm) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'permission not found'));
        if (perm.status !== 'pending') return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `permission is ${perm.status}`));
        if (perm.ownerOnly && req.body?.action === 'approve' && role !== 'owner') {
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'this step requires OWNER approval'));
        }
        const approve = req.body?.action === 'approve';
        await opPermissions.updateOne({ permissionId: perm.permissionId }, { $set: { status: approve ? 'approved' : 'rejected', decidedBy: role, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: `operator_permission_${approve ? 'approved' : 'rejected'}`, targetType: 'operator_permission', targetId: perm.permissionId });
        const session = await opSessions.findOne({ runtimeSessionId: perm.runtimeSessionId }, { projection: { _id: 0 } });
        if (!session) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'runtime session not found'));
        const stepDef = session.plan.find((s) => s.stepId === perm.stepId);
        if (stepDef) {
          if (approve) {
            // Mark approved so the loop executes it on resume.
            stepDef.status = 'pending';
            const tools = await liveRegistry();
            const tool = tools.find((t) => t.toolId === stepDef.toolId);
            if (tool) {
              // Execute the approved step directly, then continue the loop.
              if (stepDef.args.workspaceId === undefined && session.context.workspaceId !== undefined && /workspace|migration/.test(tool.toolId)) stepDef.args.workspaceId = session.context.workspaceId;
              if (stepDef.args.migrationId === undefined && session.context.migrationId !== undefined && /migration|promote|rollback/.test(tool.toolId)) stepDef.args.migrationId = session.context.migrationId;
              const exec = executors[tool.toolId];
              try {
                const res = exec ? await exec(stepDef.args, role) : { ok: false, summary: 'No executor bound.' };
                stepDef.status = res.ok ? 'done' : 'failed';
                stepDef.observation = res.summary;
                session.observations.push(res.summary);
                const rd2 = res.data as { workspaceId?: string; migration?: { migrationId?: string } } | undefined;
                if (rd2?.workspaceId) session.context.workspaceId = rd2.workspaceId;
                if (rd2?.migration?.migrationId) session.context.migrationId = rd2.migration.migrationId;
                if (res.evidenceIds?.length) session.evidenceIds.push(...res.evidenceIds);
                await recordStep(session, stepDef, narrateStep(tool.name, res.ok, res.summary), res.summary, stepDef.status);
                if (!res.ok) { const fa = classifyToolFailure(tool.toolId, res.summary); session.nextAction = fa.nextAction; }
              } catch (e) {
                stepDef.status = 'failed'; stepDef.observation = e instanceof Error ? e.message : 'failed';
              }
              session.currentStep = session.plan.indexOf(stepDef) + 1;
            }
          } else {
            stepDef.status = 'skipped';
            stepDef.observation = 'Rejected by user.';
            session.observations.push(`${stepDef.toolId} rejected — skipped.`);
            session.currentStep = session.plan.indexOf(stepDef) + 1;
          }
          session.status = 'running';
          const tools2 = await liveRegistry();
          const done = await runLoop(session, role, tools2);
          return success({ decided: approve ? 'approved' : 'rejected', session: done });
        }
        return success({ decided: approve ? 'approved' : 'rejected', session });
      });

      // --- System status --------------------------------------------------
      app.get('/v1/system/status', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [taskCount, pendingApprovals] = await Promise.all([
          tasks.countDocuments({}),
          approvals.countDocuments({ status: 'pending' }),
        ]);
        return success({ taskCount, pendingApprovals, env: env.FACTORY_ENV });
      });
    },
  });

  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
