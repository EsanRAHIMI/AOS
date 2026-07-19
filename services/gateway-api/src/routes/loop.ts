/**
 * Gateway routes — Autonomous Living Loop group (CIN-2b, D-181).
 *
 * Wires the durable loop engine (shared/src/livingloop) to the real kernel:
 * - tool execution through the SAME governed agentcore registry Jarvis uses
 *   (policy truth in one place; sensitive steps go through real approvals),
 * - model reasoning through the jarvis LLM router (honest usedFallback),
 * - a background tick (LIVING_LOOP_INTERVAL_MS, default 60s, '0' disables)
 *   that resumes stale cycles, bridges heartbeat findings into the inbox,
 *   and processes pending events — Mongo-durable, Redis-optional.
 *
 * Spec + acceptance gates: docs/cin-v2/living-loop.md.
 */
import {
  ESAN_USER_ID, failure, success, ERROR_CODES, genId, nowIso,
  buildCoreToolFamilies, type AgentToolRegistry, type ToolExecutionContext,
  ingestLoopEvent, replayInboxEvent, requeueDeadEvent, runLoopTick,
  listLoopCycles, getLoopCycle, listLoopInbox, loopLatencyStats, decideLoopApproval,
  LoopIngestBody, LoopDecisionBody, LoopReasonOutput,
  type LoopActor, type LoopDeps,
} from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req } from './deps.js';

let loopTimer: ReturnType<typeof setInterval> | null = null;

export function registerLoopRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { ctx, guard, deny, resolveAuth, declaredRole, approvals, jarvisRouter } = deps;

  const publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => ctx.publisher.publish(e);

  // The loop uses the SAME governed tool families as Jarvis (one policy truth).
  const registry: AgentToolRegistry = buildCoreToolFamilies({ publish, env: process.env });

  const actorFor = (req: Req): LoopActor => {
    const auth = resolveAuth(req);
    return { actorId: auth.primaryUserId ?? declaredRole(req), tenantId: auth.activeTenantId ?? null };
  };
  const ownerActor: LoopActor = { actorId: ESAN_USER_ID, tenantId: null };

  const loopDeps = (actor: LoopActor): LoopDeps => ({
    publish,
    toolPolicy: (toolName) => {
      const b = registry.get(toolName);
      if (!b) return null;
      return { requiresApproval: b.definition.requiresApproval, riskLevel: b.definition.riskLevel as 'low' | 'medium' | 'high' };
    },
    executeTool: async (toolName, args, execCtx) => {
      const b = registry.get(toolName);
      if (!b || !b.definition.available) return { ok: false, summary: `tool ${toolName} unavailable` };
      const parsed = b.inputSchema.safeParse(args);
      if (!parsed.success) return { ok: false, summary: `invalid args for ${toolName}` };
      const toolCtx: ToolExecutionContext = {
        actorId: execCtx.actorId, role: 'owner', isOwner: true, scope: 'user',
        tenantId: actor.tenantId ?? null, userId: execCtx.actorId,
        runId: execCtx.cycleId, sessionId: null, taskId: null, workingSet: new Map(),
      };
      try {
        const res = await b.executor(parsed.data as Record<string, unknown>, toolCtx);
        return { ok: res.ok, summary: res.summary };
      } catch (e) {
        return { ok: false, summary: e instanceof Error ? e.message : 'tool failed' };
      }
    },
    requestApproval: async (cycle, step) => {
      const approvalId = genId('appr');
      await approvals.insertOne({
        approvalId, type: 'loop_step', status: 'pending',
        title: `Living Loop: ${step.title}`,
        description: `cycle ${cycle.cycleId} · tool ${step.toolName} · risk ${step.riskLevel}\nrationale: ${cycle.decision?.rationale ?? ''}`,
        requestedBy: 'living-loop', taskId: null,
        payload: { cycleId: cycle.cycleId, stepId: step.stepId, toolName: step.toolName, args: step.args },
        createdAt: nowIso(), updatedAt: nowIso(),
      } as never);
      await publish({ type: 'approval.requested', taskId: null, payload: { approvalId, source: 'living-loop', cycleId: cycle.cycleId } });
      return approvalId;
    },
    // Real-model reasoning with the SAME honest router Jarvis uses; null on
    // fallback so the engine records usedFallback:true (never fake reasoning).
    reason: async (input) => {
      const res = await jarvisRouter.generateStructured(LoopReasonOutput, {
        agentId: 'living-loop', taskType: 'loop_reasoning',
        prompt: [
          `Trigger: ${input.triggerSummary}`,
          `Significant because: ${input.significanceReasons.join('; ')}`,
          'Explain in 1-3 sentences why this matters to the owner right now and assign a priority.',
          'JSON: {"rationale": string, "priority": "low"|"normal"|"high"|"critical"}',
        ].join('\n'),
        fallback: () => ({ rationale: '', priority: 'normal' as const }),
        fast: true,
      });
      if (res.trace.usedFallback || !res.data.rationale) return null;
      return res.data;
    },
  });

  /* ------------------------------- intake -------------------------------- */

  app.post('/v1/loop/events', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = LoopIngestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'eventKey and type are required'));
    const { event, duplicate } = await ingestLoopEvent(actorFor(req), body.data);
    return success({ inboxId: event.inboxId, duplicate });
  });

  /* -------------------------------- tick --------------------------------- */

  app.post('/v1/loop/tick', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    try {
      const result = await runLoopTick(actor, loopDeps(actor));
      return success(result);
    } catch (e) {
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, e instanceof Error ? e.message : 'tick failed'));
    }
  });

  /* ------------------------------- cycles -------------------------------- */

  app.get('/v1/loop/cycles', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { status?: string; limit?: string };
    return success({ cycles: await listLoopCycles(actorFor(req), { status: q.status, limit: q.limit ? Number(q.limit) : undefined }) });
  });

  app.get('/v1/loop/cycles/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const cycle = await getLoopCycle(actorFor(req), id);
    if (!cycle) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `cycle ${id} not found`));
    return success({ cycle });
  });

  app.post('/v1/loop/cycles/:id/decision', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const body = LoopDecisionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'action must be approve|reject'));
    const actor = actorFor(req);
    try {
      const before = await getLoopCycle(actor, id);
      const cycle = await decideLoopApproval(actor, id, body.data.action, loopDeps(actor));
      if (before?.pendingApprovalId) {
        await approvals.updateOne({ approvalId: before.pendingApprovalId }, {
          $set: { status: body.data.action === 'approve' ? 'approved' : 'rejected', decidedAt: nowIso(), decisionReason: body.data.reason ?? '' },
        });
      }
      return success({ cycleId: cycle.cycleId, status: cycle.status, outcome: cycle.outcome });
    } catch (e) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, e instanceof Error ? e.message : 'decision failed'));
    }
  });

  /* --------------------------- inbox / DLQ / replay ----------------------- */

  app.get('/v1/loop/inbox', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { status?: string; limit?: string };
    const events = await listLoopInbox(actorFor(req), { status: q.status, limit: q.limit ? Number(q.limit) : undefined });
    return success({ events, latency: loopLatencyStats(events) });
  });

  app.post('/v1/loop/inbox/:id/replay', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    try {
      const event = await replayInboxEvent(actorFor(req), id);
      return success({ inboxId: event.inboxId, replayOf: event.replayOf });
    } catch (e) {
      return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, e instanceof Error ? e.message : 'replay failed'));
    }
  });

  app.post('/v1/loop/inbox/:id/requeue', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const ok = await requeueDeadEvent(actorFor(req), id);
    return ok ? success({ inboxId: id, status: 'pending' }) : reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `dead event ${id} not found`));
  });

  /* --------------------------- background tick ---------------------------- */

  const intervalMs = Number(process.env.LIVING_LOOP_INTERVAL_MS ?? 60_000);
  if (!loopTimer && Number.isFinite(intervalMs) && intervalMs > 0) {
    loopTimer = setInterval(() => {
      void runLoopTick(ownerActor, loopDeps(ownerActor)).catch(() => {
        /* fail-soft: a bad tick must never take the gateway down */
      });
    }, intervalMs);
    if (typeof loopTimer.unref === 'function') loopTimer.unref();
  }
}
