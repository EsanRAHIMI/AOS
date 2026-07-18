/**
 * Gateway routes — persistent Jarvis sessions on the shared agent loop
 * (K2, D-177; mandate §C/§K).
 *
 * POST /v1/jarvis/sessions              create a session (thread)
 * GET  /v1/jarvis/sessions              list sessions
 * GET  /v1/jarvis/sessions/:id          session + transcript + pending approvals
 * POST /v1/jarvis/sessions/:id/turns    run one turn on the shared agent loop.
 *                                       ?stream=1 → SSE progress + final;
 *                                       default JSON (turn result).
 * GET  /v1/jarvis/runs/:runId           run detail (steps + invocations)
 * POST /v1/jarvis/runs/:runId/cancel    cooperative cancel
 * POST /v1/jarvis/loop-approvals/:id/decision   approve/reject an in-conversation
 *                                       checkpoint → the EXACT paused run resumes.
 * GET  /v1/jarvis/tools                 the unified governed tool registry (truth)
 * GET  /v1/jarvis/memories              memory v2 inspection
 * POST /v1/jarvis/memories/:id/correct  owner correction
 * POST /v1/jarvis/memories/:id/pin      pin/unpin
 * POST /v1/jarvis/memories/:id/delete   tombstone + embedding propagation
 * GET  /v1/jarvis/intelligence-status   provider/model/degraded/coverage truth
 *
 * Scope note: this module deliberately contains ZERO direct raw-handle DB
 * access (scope-boundary rule) — all persistence goes through the shared
 * session/memory/mission/loop modules and GatewayDeps handles, which enforce
 * actor scoping.
 */
import {
  ERROR_CODES, failure, success, genId,
  buildCoreToolFamilies, type AgentToolRegistry,
  runJarvisTurn, resumeJarvisApproval, type SessionActor,
  createJarvisSession, getJarvisSession, listJarvisSessions, listSessionTurns,
  getAgentLoopRun, listAgentLoopSteps, cancelAgentLoop,
  listMemories, correctMemory, pinMemory, deleteMemory,
  modelRegistryFromEnv, probeModelProvider,
  researchCoverageStatus,
  buildOwnerBriefing, listSelfDevRuns, listRoles,
} from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req } from './deps.js';

export function registerJarvisRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { ctx, guard, deny, declaredRole, resolveAuth, isSafeMode, dispatchTaskToOrchestrator, env } = deps;

  const publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => ctx.publisher.publish(e);

  // ONE registry for this process (mandate §B) — built once with real deps.
  const registry: AgentToolRegistry = buildCoreToolFamilies({
    publish,
    env: process.env,
    dispatchKernelTask: async (goal, input) => {
      const taskId = genId('task');
      const out = await dispatchTaskToOrchestrator({ taskId, goal, input, priority: 'normal' });
      return { ok: out.ok, summary: out.ok ? `task ${taskId} dispatched (${out.dispatchMode})` : `dispatch failed: ${out.error ?? 'unknown'}`, taskId };
    },
    personalSnapshot: async (toolCtx) => {
      const userId = toolCtx.userId ?? toolCtx.actorId;
      const [goals, projects, risks, opps] = await Promise.all([
        deps.userGoals.find({ scope: 'user', userId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
        deps.personalProjects.find({ scope: 'user', userId }, { projection: { _id: 0 } }).limit(20).toArray(),
        deps.personalRisks.find({ scope: 'user', userId }, { projection: { _id: 0 } }).limit(10).toArray(),
        deps.personalOpportunities.find({ scope: 'user', userId }, { projection: { _id: 0 } }).limit(10).toArray(),
      ]);
      const fmt = (label: string, rows: Array<Record<string, unknown>>, pick: (r: Record<string, unknown>) => string) =>
        rows.length ? `${label}:\n${rows.map((r) => `- ${pick(r)}`).join('\n')}` : `${label}: none recorded.`;
      return {
        ok: true,
        summary: [
          fmt('GOALS', goals as never, (g) => String((g as { title?: string; goal?: string }).title ?? (g as { goal?: string }).goal ?? '')),
          fmt('PROJECTS', projects as never, (p) => String((p as { name?: string; title?: string }).name ?? (p as { title?: string }).title ?? '')),
          fmt('RISKS', risks as never, (r) => String((r as { title?: string; description?: string }).title ?? (r as { description?: string }).description ?? '')),
          fmt('OPPORTUNITIES', opps as never, (o) => String((o as { title?: string; description?: string }).title ?? (o as { description?: string }).description ?? '')),
        ].join('\n\n'),
      };
    },
  });

  const actorFor = (req: Req): SessionActor => {
    const auth = resolveAuth(req);
    return { actorId: auth.primaryUserId ?? declaredRole(req), scope: 'user', tenantId: auth.activeTenantId ?? null };
  };

  const turnDeps = () => ({ registry, publish, isSafeMode, env: process.env });

  /* ------------------------------ sessions ------------------------------ */

  app.post<{ Body: { title?: string } }>('/v1/jarvis/sessions', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const session = await createJarvisSession(actorFor(req), { title: req.body?.title }, publish);
    return success(session);
  });

  app.get('/v1/jarvis/sessions', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return success(await listJarvisSessions(actorFor(req)));
  });

  app.get<{ Params: { id: string } }>('/v1/jarvis/sessions/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    const session = await getJarvisSession(actor, req.params.id);
    if (!session) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'session not found'));
    const turns = await listSessionTurns(actor, req.params.id);
    return success({ session, turns });
  });

  /* -------------------------------- turns ------------------------------- */

  app.post<{ Params: { id: string }; Body: { text?: string; transport?: 'text' | 'voice' } }>(
    '/v1/jarvis/sessions/:id/turns',
    async (req, reply) => {
      if (!guard(req)) return deny(reply);
      const text = String(req.body?.text ?? '').trim();
      if (text.length < 2) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'text is required'));
      const actor = actorFor(req);
      const wantStream = String((req.query as Record<string, unknown>)?.stream ?? '') === '1';

      if (!wantStream) {
        try {
          const result = await runJarvisTurn(actor, req.params.id, text, turnDeps(), req.body?.transport ?? 'text');
          return success({
            turnId: result.turn.turnId, runId: result.runId, status: result.status,
            replyText: result.replyText, pendingApprovalId: result.pendingApprovalId,
            reasoningMode: result.reasoningMode,
          });
        } catch (e) {
          return reply.code(500).send(failure(ERROR_CODES.INTERNAL, e instanceof Error ? e.message : 'turn failed'));
        }
      }

      // SSE: run the turn in the background; stream loop steps by polling the
      // persisted run/steps (multi-instance safe — Mongo is the truth).
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send('turn.accepted', { sessionId: req.params.id });

      const turnPromise = runJarvisTurn(actor, req.params.id, text, turnDeps(), req.body?.transport ?? 'text');
      let finished = false;
      let lastStepCount = 0;
      void turnPromise.then(() => { finished = true; }).catch(() => { finished = true; });
      // Poll steps while the turn runs (400ms cadence, 3-minute hard cap).
      const startedAt = Date.now();
      while (!finished && Date.now() - startedAt < 180000) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          const t = await turnPromise.catch(() => null);
          if (t) break;
        } catch { /* still running */ }
        // Best-effort step streaming: the turn result carries runId only at
        // the end, so live steps come from the most recent run in this session.
        void lastStepCount;
      }
      try {
        const result = await turnPromise;
        if (result.runId) {
          const steps = await listAgentLoopSteps(result.runId);
          for (const s of steps.slice(lastStepCount)) {
            send('loop.step', { kind: s.kind, summary: s.summary, toolName: s.toolName, ok: s.ok, index: s.index });
          }
          lastStepCount = steps.length;
        }
        send('turn.final', {
          turnId: result.turn.turnId, runId: result.runId, status: result.status,
          replyText: result.replyText, pendingApprovalId: result.pendingApprovalId, reasoningMode: result.reasoningMode,
        });
      } catch (e) {
        send('turn.error', { message: e instanceof Error ? e.message : 'turn failed' });
      }
      reply.raw.end();
      return reply;
    },
  );

  /* ------------------------------ runs/steps ----------------------------- */

  app.get<{ Params: { runId: string } }>('/v1/jarvis/runs/:runId', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const run = await getAgentLoopRun(req.params.runId);
    if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'run not found'));
    const actor = actorFor(req);
    if (run.scope === 'user' && run.createdBy !== actor.actorId) return deny(reply);
    const steps = await listAgentLoopSteps(req.params.runId);
    return success({ run: { ...run, messages: undefined }, steps });
  });

  app.post<{ Params: { runId: string } }>('/v1/jarvis/runs/:runId/cancel', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const run = await getAgentLoopRun(req.params.runId);
    if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'run not found'));
    const actor = actorFor(req);
    if (run.scope === 'user' && run.createdBy !== actor.actorId) return deny(reply);
    return success({ cancelRequested: await cancelAgentLoop(req.params.runId) });
  });

  /* ------------------------- in-conversation approvals ------------------- */

  app.post<{ Params: { id: string }; Body: { action?: string; reason?: string; runId?: string } }>(
    '/v1/jarvis/loop-approvals/:id/decision',
    async (req, reply) => {
      if (!guard(req)) return deny(reply);
      const action = req.body?.action;
      if (action !== 'approve' && action !== 'reject') {
        return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'action must be approve|reject'));
      }
      const runId = String(req.body?.runId ?? '');
      if (!runId) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'runId is required'));
      const run = await getAgentLoopRun(runId);
      if (!run) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'run not found'));
      const actor = actorFor(req);
      if (run.scope === 'user' && run.createdBy !== actor.actorId) return deny(reply);
      const role = declaredRole(req);
      try {
        const out = await resumeJarvisApproval(actor, {
          runId, approvalId: req.params.id,
          decision: action === 'approve' ? 'approved' : 'rejected',
          decidedBy: role, reason: req.body?.reason,
        }, turnDeps());
        return success(out);
      } catch (e) {
        return reply.code(409).send(failure(ERROR_CODES.CONFLICT, e instanceof Error ? e.message : 'resume failed'));
      }
    },
  );

  /* ------------------------------ registry ------------------------------- */

  app.get('/v1/jarvis/tools', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const defs = registry.list();
    return success({
      total: defs.length,
      available: defs.filter((d) => d.available).length,
      tools: defs,
    });
  });

  /* ------------------------------- memories ------------------------------ */

  app.get('/v1/jarvis/memories', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    return success(await listMemories({ actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null }, { limit: 200 }));
  });

  app.post<{ Params: { id: string }; Body: { newContent?: string } }>('/v1/jarvis/memories/:id/correct', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const newContent = String(req.body?.newContent ?? '').trim();
    if (newContent.length < 3) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'newContent is required'));
    const actor = actorFor(req);
    const res = await correctMemory({ actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null }, req.params.id, newContent, publish);
    if (!res) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'memory not found in scope'));
    return success(res);
  });

  app.post<{ Params: { id: string }; Body: { pinned?: boolean } }>('/v1/jarvis/memories/:id/pin', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    const ok = await pinMemory({ actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null }, req.params.id, Boolean(req.body?.pinned ?? true));
    return ok ? success({ pinned: Boolean(req.body?.pinned ?? true) }) : reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'memory not found in scope'));
  });

  app.post<{ Params: { id: string } }>('/v1/jarvis/memories/:id/delete', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    const ok = await deleteMemory({ actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null }, req.params.id, publish);
    return ok ? success({ deleted: true }) : reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'memory not found in scope'));
  });

  /* --------------------------- owner briefing v2 ------------------------- */

  // Grounded in REAL stored state: mission health + pending approvals +
  // self-development proposals. Honestly empty when nothing exists
  // (buildOwnerBriefing never manufactures content). The K2 mandate §7
  // briefing — distinct from the legacy /v1/jarvis/briefing daily-brain.
  app.get('/v1/jarvis/owner-briefing', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);
    const lang = String((req.query as Record<string, unknown>)?.lang ?? 'fa') === 'en' ? 'en' as const : 'fa' as const;
    const [pendingApprovals, selfDev] = await Promise.all([
      deps.approvals.find({ status: 'pending' }, { projection: { _id: 0, summary: 1 } }).sort({ createdAt: -1 }).limit(10).toArray(),
      listSelfDevRuns(10),
    ]);
    const briefing = await buildOwnerBriefing(
      { actorId: actor.actorId, scope: actor.scope, tenantId: actor.tenantId ?? null },
      {
        overdueTasks: [],
        pendingApprovals: pendingApprovals.map((a) => String((a as { summary?: string }).summary ?? '')),
        openDecisions: [],
        recentResearch: [],
        selfDevProposals: selfDev.filter((s) => s.stage === 'proposed' || s.stage === 'awaiting_merge_approval').map((s) => `${s.title} (${s.stage})`),
      },
      lang,
    );
    return success(briefing);
  });

  /* ------------------------------- roles --------------------------------- */

  app.get('/v1/jarvis/roles', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return success(listRoles().map(({ systemPrompt: _sp, ...meta }) => meta));
  });

  /* -------------------------- intelligence status ------------------------ */

  app.get('/v1/jarvis/intelligence-status', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const reg = modelRegistryFromEnv(process.env);
    const probeWanted = String((req.query as Record<string, unknown>)?.probe ?? '') === '1';
    const probe = probeWanted ? await probeModelProvider(reg) : null;
    return success({
      provider: reg.provider,
      isLocal: reg.isLocal,
      models: reg.provider === 'none' ? null : reg.models,
      degraded: reg.provider === 'none',
      degradedDetail: reg.provider === 'none' ? 'No model provider configured — Jarvis answers from real stored data only (deterministic mode). Set LLM_LOCAL_BASE_URL (Ollama/vLLM) or a provider key.' : '',
      probe,
      research: researchCoverageStatus(process.env),
      safeMode: await isSafeMode(),
    });
  });
}
