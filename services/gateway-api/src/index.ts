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
  peerUrl,
  TaskRequestSchema,
  hasValidInternalToken,
  hasValidAdminToken,
  success,
  failure,
  ERROR_CODES,
  genId,
  nowIso,
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
  await tasks.createIndex({ taskId: 1 }, { unique: true });
  await approvals.createIndex({ approvalId: 1 }, { unique: true });
  await infra.createIndex({ requestId: 1 }, { unique: true });

  const service = await createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    routes: (app, ctx) => {
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

      // --- Tasks ----------------------------------------------------------
      app.post('/v1/tasks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
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
