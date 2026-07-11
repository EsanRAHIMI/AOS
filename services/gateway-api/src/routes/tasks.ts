/**
 * Gateway routes — tasks group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, EVENT_TYPES, INTERNAL_TOKEN_HEADER, TaskRequestSchema, buildAuditLog, failure, genId, nowIso, success } from '@factory/shared';
import type { Approval, Task } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerTasksRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    ctx,
    guard,
    deny,
    rateLimited,
    enforce,
    tasks,
    approvals,
    infra,
    events,
    auditLogs,
    dispatchTaskToOrchestrator,
  } = deps;

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

        // Forward to the orchestrator (best-effort; task is persisted
        // regardless). K1 BullMQ Producer Adoption (D-174): routes through
        // BullMQ when AGENT_DISPATCH_MODE is queue-capable and REDIS_URL is
        // set, else the exact original best-effort HTTP forward — see
        // dispatchTaskToOrchestrator (server.ts) and decision-log D-174.
        await dispatchTaskToOrchestrator({ taskId: task.taskId, goal: task.goal, input: parsed.data.input, priority: task.priority });
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

}
