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
  connectMongo,
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  PeerClient,
  genId,
  nowIso,
  type Task,
  type Approval,
  type AgentRun,
} from '@factory/shared';
import { createFactoryService, type TaskHandler, type ServiceContext } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';
import { runPipeline } from './pipeline.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

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

  // Run the pipeline in the background; respond immediately for a live timeline.
  void runPipeline({ taskId, goal: req.goal, ctx, peer })
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

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
  });

  await service.listen();
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
