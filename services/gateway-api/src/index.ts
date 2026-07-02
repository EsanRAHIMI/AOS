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
        const active = rows.find((p) => !TERMINAL.has(p.status)) ?? rows[0] ?? null;
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
