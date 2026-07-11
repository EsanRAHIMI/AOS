/**
 * Gateway routes — agent-jobs group (K1 BullMQ Producer Adoption, D-174).
 *
 * The DLQ operational surface required by decision-log D-174 requirement 6:
 * list dead letters, inspect a job run's last error, replay a dead letter,
 * cancel a waiting job. Read routes are guard()-only (same as every other
 * read route in this file group); the two mutating routes go through the
 * same enforce()/buildAuditLog() pattern already used for confirmInfra/
 * decideApproval/decideRepairPlan — see shared/src/governance/index.ts's
 * DASHBOARD_ACTION_PERMISSIONS (`replayAgentJob`/`cancelAgentJob`, both
 * require the `manage_agent_jobs` permission, both correctly blocked in
 * safe mode via SAFE_MODE_BLOCKED_ACTIONS).
 *
 * Deliberately does NOT expose a "list all job runs" or "list by task"
 * endpoint — `agent_job_runs` is an internal delivery-mechanism ledger (see
 * shared/src/queue/index.ts's module doc comment), not a new user-facing
 * domain concept. Dead-letter listing/inspection/replay/cancel is the
 * complete DLQ operational surface this workstream asked for.
 */
import { ERROR_CODES, EVENT_TYPES, failure, getJobRun, listDeadLetters, success } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerAgentJobsRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { ctx, guard, deny, declaredRole, enforce, writeAudit, agentQueueClient } = deps;

  app.get<{ Querystring: { serviceId?: string } }>('/v1/agent-jobs/dead-letters', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const serviceId = req.query.serviceId;
    if (!serviceId) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'serviceId query param is required'));
    const rows = await listDeadLetters(serviceId);
    return success(rows);
  });

  app.get<{ Params: { jobRunId: string } }>('/v1/agent-jobs/:jobRunId', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const run = await getJobRun(req.params.jobRunId);
    if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'job run not found'));
    return success(run);
  });

  app.post<{ Params: { jobRunId: string } }>('/v1/agent-jobs/:jobRunId/replay', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    if (await enforce('replayAgentJob', req, reply)) return reply;
    const run = await getJobRun(req.params.jobRunId);
    if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'job run not found'));
    const role = declaredRole(req);
    const result = await agentQueueClient.replayDeadLetter(run.serviceId, run.jobRunId);
    await writeAudit({
      actorType: role === 'agent' ? 'agent' : 'human',
      actorId: role,
      role,
      action: 'agent_job_replayed',
      targetType: 'agent_job_run',
      targetId: run.jobRunId,
      before: { status: run.status },
      after: { enqueued: result.enqueued, reason: result.reason ?? null },
      reason: `Manual replay of dead-lettered job for ${run.serviceId}`,
    });
    await ctx.publisher.publish({
      type: EVENT_TYPES.AGENT_JOB_QUEUED,
      taskId: run.taskId,
      payload: { jobRunId: run.jobRunId, serviceId: run.serviceId, message: `Dead-lettered job manually replayed by ${role}`, replay: true },
    });
    return success(result);
  });

  app.post<{ Params: { jobRunId: string } }>('/v1/agent-jobs/:jobRunId/cancel', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    if (await enforce('cancelAgentJob', req, reply)) return reply;
    const run = await getJobRun(req.params.jobRunId);
    if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'job run not found'));
    const role = declaredRole(req);
    const before = run.status;
    const cancelled = await agentQueueClient.cancel(run.serviceId, run.jobRunId);
    await writeAudit({
      actorType: role === 'agent' ? 'agent' : 'human',
      actorId: role,
      role,
      action: 'agent_job_cancelled',
      targetType: 'agent_job_run',
      targetId: run.jobRunId,
      before: { status: before },
      after: { status: cancelled?.status ?? before },
      reason: `Manual cancel of ${run.status} job for ${run.serviceId}. Best-effort: an already-running processor is not force-killed — see decision-log D-174.`,
    });
    return success(cancelled ?? { jobRunId: run.jobRunId, cancelled: false, reason: 'already in a terminal state' });
  });
}
