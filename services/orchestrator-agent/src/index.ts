/**
 * Orchestrator Agent — entry point (Phase 2).
 *
 * The central brain. Accepts a goal, then runs a delegation pipeline in the
 * background: architect → builder → devops → documentation → memory. It emits a
 * descriptive live timeline (task.updated events with human-readable messages),
 * creates an approval gate after the devops infrastructure request, compiles a
 * final human-readable report into the task, and leaves the task awaiting the
 * owner's approval to proceed.
 *
 * It returns from /.factory/task immediately so the dashboard can watch progress
 * stream in live. Cross-service calls are HTTP-only (PeerClient), so each
 * service stays independently deployable.
 */
import {
  loadEnv,
  BaseEnvSchema,
  MongoEnvSchema,
  LlmEnvSchema,
  RedisEnvSchema,
  AgentQueueEnvSchema,
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  PeerClient,
  createAgentTaskWorker,
  AgentTaskQueueClient,
  genId,
  nowIso,
  buildSeedCapabilities,
  buildScoringProfile,
  buildSeedRoles,
  buildSeedPermissions,
  buildSeedUsers,
  seedLearningSchedule,
  DEFAULT_SCORING_WEIGHTS,
  type Task,
  type Approval,
  type AgentRun,
  type Capability,
  type ExpansionProposal,
  type CapabilityGap,
  type Evaluation,
  type LlmTrace,
  type ScoringProfile,
  type Role,
  type Permission,
  type RbacUser,
  type AgentTaskWorkerHandle,
} from '@factory/shared';
import { createFactoryService, type TaskHandler, type ServiceContext } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';
import { runPipeline, runBuildPipeline } from './pipeline.js';

// RedisEnvSchema/AgentQueueEnvSchema (K1 BullMQ Producer Adoption, D-174):
// REDIS_URL unset (the default) means the BullMQ Worker started in main()
// below simply doesn't start — this process runs exactly as it did before
// D-174, HTTP-`/.factory/task`-only. Setting REDIS_URL additionally starts
// one Worker consuming the `agent-tasks:orchestrator-agent` queue, calling
// the SAME `handleTask` the HTTP route already calls — both paths work in
// parallel. This is what lets gateway-api's dispatchTaskToOrchestrator
// (server.ts) actually deliver queued work somewhere; see decision-log D-174.
const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema).merge(RedisEnvSchema).merge(AgentQueueEnvSchema));

// K1 BullMQ Producer Adoption (D-174): one queue client, constructed once at
// module scope (same pattern as gateway-api's server.ts), used by
// pipeline.ts's dispatchPeerTask for every orchestrator→{architect,qa,
// reviewer,report,memory,documentation-service,internet-research-service}
// call. `.enabled` is false when REDIS_URL is unset — dispatchPeerTask
// degrades to the exact original peer.dispatchTask HTTP call in that case.
const agentQueueClient = new AgentTaskQueueClient({
  redisUrl: env.REDIS_URL,
  maxAttempts: env.AGENT_QUEUE_MAX_ATTEMPTS,
  backoffMs: env.AGENT_QUEUE_BACKOFF_MS,
});

/** Idempotently seed the capability graph with the kernel's built-in abilities. */
async function seedCapabilities(): Promise<void> {
  const caps = collection<Capability>(COLLECTIONS.CAPABILITIES);
  for (const c of buildSeedCapabilities()) {
    await caps.updateOne({ capabilityId: c.capabilityId }, { $setOnInsert: c }, { upsert: true });
  }
}

/** Seed governance: scoring profile v1 (active), RBAC roles/permissions/users. */
async function seedGovernance(): Promise<void> {
  const profiles = collection<ScoringProfile>(COLLECTIONS.SCORING_PROFILES);
  if ((await profiles.countDocuments({})) === 0) {
    await profiles.insertOne(buildScoringProfile(1, DEFAULT_SCORING_WEIGHTS, { status: 'active', reason: 'seed', approvedBy: 'system' }));
  }
  const roles = collection<Role>(COLLECTIONS.ROLES);
  for (const r of buildSeedRoles()) await roles.updateOne({ roleId: r.roleId }, { $setOnInsert: r }, { upsert: true });
  const perms = collection<Permission>(COLLECTIONS.PERMISSIONS);
  for (const p of buildSeedPermissions()) await perms.updateOne({ permissionId: p.permissionId }, { $setOnInsert: p }, { upsert: true });
  const users = collection<RbacUser>(COLLECTIONS.USERS);
  for (const u of buildSeedUsers()) await users.updateOne({ userId: u.userId }, { $setOnInsert: u }, { upsert: true });
  // Phase 10 — default learning schedule.
  const schedules = collection(COLLECTIONS.LEARNING_SCHEDULES);
  if ((await schedules.countDocuments({})) === 0) await schedules.insertOne(seedLearningSchedule() as never);
}

const handleTask: TaskHandler = async (req, ctx: ServiceContext) => {
  const taskId = req.taskId ?? genId('task');
  const peer = new PeerClient({ internalToken: env.FACTORY_INTERNAL_TOKEN, env: process.env });

  // Record the orchestrator's own run.
  const agentRunId = genId('arun');
  const run: AgentRun = {
    agentRunId,
    agentId: manifest.serviceId,
    serviceId: manifest.serviceId,
    taskId,
    status: 'running',
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    startedAt: nowIso(),
    finishedAt: null,
    error: null,
  };
  await collection<AgentRun>(COLLECTIONS.AGENT_RUNS).insertOne(run);
  await ctx.publisher.publish({
    type: EVENT_TYPES.AGENT_RUN_STARTED,
    taskId,
    payload: { agentRunId, message: 'Orchestrator received goal', goal: req.goal },
  });

  // Choose pipeline: build-from-approved-proposal, or analyze-then-delegate.
  const action = (req.input as Record<string, unknown> | undefined)?.action;
  const dispatchArgs = { agentQueueClient, dispatchMode: env.AGENT_DISPATCH_MODE, dispatchWaitMs: env.AGENT_QUEUE_TIMEOUT_MS };
  const pipeline =
    action === 'build_from_proposal'
      ? runBuildPipeline({ taskId, goal: req.goal, ctx, peer, input: req.input, ...dispatchArgs })
      : runPipeline({ taskId, goal: req.goal, ctx, peer, input: req.input, ...dispatchArgs });

  // Run the pipeline in the background; respond immediately for a live timeline.
  void pipeline
    .then(async () => {
      await collection<AgentRun>(COLLECTIONS.AGENT_RUNS).updateOne(
        { agentRunId },
        { $set: { status: 'succeeded', finishedAt: nowIso(), steps: 6 } },
      );
    })
    .catch(async (e: unknown) => {
      ctx.log.error({ err: e, taskId }, 'pipeline failed');
      await collection<AgentRun>(COLLECTIONS.AGENT_RUNS).updateOne(
        { agentRunId },
        { $set: { status: 'failed', finishedAt: nowIso(), error: String(e) } },
      );
      await collection<Task>(COLLECTIONS.TASKS).updateOne(
        { taskId },
        { $set: { status: 'failed', error: String(e), updatedAt: nowIso() } },
      );
      await ctx.publisher.publish({
        type: EVENT_TYPES.TASK_FAILED,
        taskId,
        payload: { message: 'Pipeline failed', error: String(e) },
      });
    });

  return { taskId, accepted: true, agentRunId };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await collection<Approval>(COLLECTIONS.APPROVALS).createIndex({ approvalId: 1 }, { unique: true });
  await collection<Capability>(COLLECTIONS.CAPABILITIES).createIndex({ capabilityId: 1 }, { unique: true });
  await collection<CapabilityGap>(COLLECTIONS.CAPABILITY_GAPS).createIndex({ gapId: 1 }, { unique: true });
  await collection<ExpansionProposal>(COLLECTIONS.EXPANSION_PROPOSALS).createIndex({ proposalId: 1 }, { unique: true });
  await collection<Evaluation>(COLLECTIONS.CAPABILITY_EVALUATIONS).createIndex({ evaluationId: 1 }, { unique: true });
  await collection<LlmTrace>(COLLECTIONS.LLM_TRACES).createIndex({ traceId: 1 }, { unique: true });
  await collection(COLLECTIONS.STRATEGIC_PLANS).createIndex({ planId: 1 }, { unique: true });
  await collection(COLLECTIONS.PLAN_SCORES).createIndex({ scoreId: 1 }, { unique: true });
  await collection(COLLECTIONS.POLICY_DECISIONS).createIndex({ policyDecisionId: 1 }, { unique: true });
  await collection(COLLECTIONS.DECISION_MEMORIES).createIndex({ decisionId: 1 }, { unique: true });
  await collection(COLLECTIONS.SCORING_PROFILES).createIndex({ profileId: 1 }, { unique: true });
  await collection(COLLECTIONS.OUTCOME_REVIEWS).createIndex({ reviewId: 1 }, { unique: true });
  await collection(COLLECTIONS.SCORING_CHANGE_PROPOSALS).createIndex({ proposalId: 1 }, { unique: true });
  await collection(COLLECTIONS.AUDIT_LOGS).createIndex({ auditId: 1 }, { unique: true });
  await collection(COLLECTIONS.LEARNING_RUNS).createIndex({ learningRunId: 1 }, { unique: true });
  await collection(COLLECTIONS.OPERATIONAL_PATTERNS).createIndex({ patternId: 1 }, { unique: true });
  await collection(COLLECTIONS.SYSTEM_RECOMMENDATIONS).createIndex({ recommendationId: 1 }, { unique: true });
  await collection(COLLECTIONS.IMPROVEMENT_WORKFLOWS).createIndex({ workflowId: 1 }, { unique: true });
  await collection(COLLECTIONS.IMPACT_ASSESSMENTS).createIndex({ impactAssessmentId: 1 }, { unique: true });
  await collection(COLLECTIONS.MEMORY_MAINTENANCE_RUNS).createIndex({ maintenanceRunId: 1 });
  await seedCapabilities();
  await seedGovernance();

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
    // K1 BullMQ Producer Adoption (D-174): a second listener (the BullMQ
    // Worker below) shares this process, same reason as aos-agent-runtime —
    // see the doc comment on this option in packages/service-kit.
    registerSignalHandlers: false,
  });

  await service.listen();

  // --- K1 BullMQ Producer Adoption (D-174) — queue consumption ------------
  // orchestrator-agent's OWN task handler, wired to a BullMQ Worker so it can
  // consume jobs gateway-api enqueues via dispatchTaskToOrchestrator. Uses
  // manifest.serviceId ('orchestrator-agent') as the queue name, matching
  // exactly what gateway-api's AgentTaskQueueClient.enqueue('orchestrator-agent', ...) targets.
  const queueHandle: AgentTaskWorkerHandle = createAgentTaskWorker({
    serviceId: manifest.serviceId,
    redisUrl: env.REDIS_URL,
    handler: handleTask,
    ctx: service.ctx,
    concurrency: env.AGENT_QUEUE_CONCURRENCY,
    timeoutMs: env.AGENT_QUEUE_TIMEOUT_MS,
    publish: (e) => service.ctx.publisher.publish(e),
  });
  if (queueHandle.enabled) {
    console.log('orchestrator-agent: BullMQ queue worker ENABLED (REDIS_URL set) — HTTP /.factory/task remains fully functional in parallel');
  } else {
    console.log('orchestrator-agent: REDIS_URL not set — queue worker disabled, HTTP-only mode (unchanged from pre-D-174 behavior)');
  }

  // Single shared graceful shutdown for the HTTP service + the queue worker —
  // see registerSignalHandlers:false above and its doc comment.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      console.log(`orchestrator-agent: received ${sig}, shutting down HTTP + queue worker`);
      void Promise.all([service.close(), queueHandle.close()]).finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
