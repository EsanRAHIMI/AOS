/**
 * Gateway routes — operator group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, ESAN_USER_ID, EVENT_TYPES, IMPORTANT_OPERATOR_EVENT_TYPES, buildCapabilityAnswer, classifyGoalScope, classifyIntent, classifyToolFailure, collection, decideJarvisMode, detectLanguage, failure, genId, isCapabilityQuestion, legacyRoleToAuthContext, narrateStep, normalizeUtterance, nowIso, planForGoal, sortRecentSessions, success } from '@factory/shared';
import type { OperatorRuntimeSession } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerOperatorRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    ctx,
    guard,
    deny,
    declaredRole,
    writeAudit,
    rateLimited,
    enforce,
    isSafeMode,
    codeAgentTask,
    liveRegistry,
    executors,
    composeAndRecordJarvisTurn,
    recordStep,
    runLoop,
    jarvisRouter,
    jarvisGov,
    tasks,
    events,
    capabilities,
    jarvisTurns,
    opToolRuns,
    opPermissions,
    opSessions,
    opSteps,
    opMemories,
  } = deps;

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
      // Phase AF.4.1 — the live operation feed. Real, persisted data only —
      // every field here is a direct read from a collection that already
      // existed (opSessions/opPermissions/tasks/events/jarvisTurns); nothing
      // is invented or placeholder. This exists because the frontend had no
      // way to reconstruct "what's happening / what just happened" after a
      // page refresh — session/approval/event state lived only in React
      // memory (see docs/decision-log.md D-12x). Uses the same active-status
      // set as `/v1/operator/sessions/active` above, plus a small recent
      // window of terminal sessions so a just-finished operation's result is
      // still visible for a moment after it completes, not just while active.
      //
      // Phase AF.4.4 — `activeSessions`' limit(5) was a correctness bug, not
      // just a tight cap: a genuinely still-running/waiting-approval session
      // could silently vanish from Overview/Live Activity the moment a 6th
      // one started, even though it hadn't finished. Raised to 20 — cheap
      // (indexed status filter, single-owner-scale document counts) and
      // large enough that hitting it would itself be a signal something
      // unusual is happening. `recentSessions`/`recentTasks`/`recentEvents`
      // are lower-stakes (already-finished history, not "is this still
      // running") but were raised too so a busy stretch doesn't age a
      // just-finished result out of view before the next real event arrives
      // to refresh it.
      app.get('/v1/operator/live-state', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const ACTIVE_SESSION_STATUSES = ['planning', 'running', 'waiting_approval', 'verifying'] as const;
        const [activeSessions, recentSessionsRaw, pendingApprovals, recentTasks, recentEvents, recentJarvisTurns] = await Promise.all([
          opSessions.find({ status: { $in: ACTIVE_SESSION_STATUSES } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(20).toArray(),
          // Secondary tiebreaker on startedAt: two sessions can legitimately
          // share the same completedAt millisecond, and Mongo's tie order is
          // otherwise unspecified. sortRecentSessions() below is the real,
          // deterministic ordering guarantee (also covers any session where
          // completedAt was historically left null); this query-level sort
          // just narrows the DB-side candidate set before that final pass.
          opSessions.find({ status: { $in: ['completed', 'failed'] } }, { projection: { _id: 0 } }).sort({ completedAt: -1, startedAt: -1 }).limit(10).toArray(),
          opPermissions.find({ status: 'pending' }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray(),
          tasks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray(),
          events.find({ type: { $in: [...IMPORTANT_OPERATOR_EVENT_TYPES] } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
          jarvisTurns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(5).toArray(),
        ]);
        // Phase AG.3 — deterministic recency ordering applied in application
        // code, not trusted to the DB sort alone (see decision-log): a failed
        // session must never display ahead of a newer completed one.
        const recentSessions = sortRecentSessions(recentSessionsRaw);
        const headline = activeSessions[0] ?? recentSessions[0] ?? null;
        const activeOperationSummary = headline ? `${headline.goal} — ${headline.status.replace(/_/g, ' ')}` : null;
        return success({ activeSessions, recentSessions, pendingApprovals, recentTasks, recentEvents, recentJarvisTurns, activeOperationSummary, generatedAt: nowIso() });
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
          composedReply: '', composedLanguage: '', composedFollowUps: [],
          scope: scopeClass.scope,
          tenantId: scopeClass.scope === 'global' ? undefined : authCtx.activeTenantId,
          createdBy: authCtx.actorId,
          visibility: scopeClass.scope === 'user' ? 'private' : scopeClass.scope === 'global' ? 'public' : 'tenant',
        };
        if (scopeClass.scope === 'user') session.context.scopeUserId = authCtx.primaryUserId;
        await opSessions.insertOne(session);
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_SESSION_STARTED, taskId: null, payload: { runtimeSessionId: session.runtimeSessionId, goal: text.slice(0, 120), scope: scopeClass.scope, message: `Operator session started (${scopeClass.mode}): ${planned.narration}` } });

        // Phase AF.4 — this used to `await runLoop(...)` (every tool step,
        // real network/DB calls) THEN `await composeAndRecordJarvisTurn`
        // (an LLM call) before responding at all — the exact root cause of
        // 10+ second waits for any goal that runs real tools. The session is
        // already persisted above with a real plan and status='planning', so
        // the client can be told about it immediately; `runLoop` now persists
        // its own progress after every step (see `recordStep`), so the
        // client's existing 2.5s session poll shows genuine incremental
        // progress instead of one long silent block. The LLM-composed reply
        // lands on `session.composedReply` once ready, for the poll to pick
        // up — never a second synchronous wait.
        void (async () => {
          try {
            const done = await runLoop(session, role, tools);
            const planSummary = done.reportSummary || done.observations[done.observations.length - 1] || planned.narration;
            const answer = await composeAndRecordJarvisTurn({ text, intent, authCtx, scopeClass, mode, planSummary, forceFallback });
            await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: { composedReply: answer.reply, composedLanguage: answer.language, composedFollowUps: answer.suggestedFollowUps } });
          } catch (e) {
            ctx.log.error({ err: e, runtimeSessionId: session.runtimeSessionId }, 'background operator session failed');
            await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: { status: 'failed', reportSummary: 'Internal error running the session — see server logs.', completedAt: nowIso() } }).catch(() => { /* nothing more we can do */ });
          }
        })();

        // Phase AF.3 — session replies now carry the same real, already-
        // classified intentCategory that answer-kind replies always have
        // (Phase AD). Previously only 'answer' replies exposed it (recorded
        // as an honest gap in D-104); tool-routed goals are exactly the kind
        // of reply most likely to concern a specific Domain Canvas zone, so
        // leaving it off here was the bigger gap of the two.
        return success({ kind: 'session', narration: planned.narration, reply: planned.narration, language: detectLanguage(text), suggestedFollowUps: [], session, scopeContext, intentCategory: intent.category });
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
        // Phase AF.4.1 — this endpoint previously updated state but published
        // nothing, so neither the live operation feed nor any SSE listener
        // could ever observe the moment a decision was made (only the
        // eventual session completion, seconds later). Publish immediately,
        // before the (possibly slow) synchronous step execution below, so
        // the client's optimistic "approving…" UI has a real event to
        // reconcile against even if the step itself takes a moment.
        await ctx.publisher.publish({ type: EVENT_TYPES.OPERATOR_APPROVAL_DECIDED, taskId: null, payload: { runtimeSessionId: perm.runtimeSessionId, permissionId: perm.permissionId, decision: approve ? 'approved' : 'rejected', message: `${approve ? 'Approved' : 'Rejected'}: ${perm.prompt.slice(0, 100)}` } });
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
          // Phase AF.4 — the just-decided step already ran synchronously
          // above (the caller needs to know THAT outcome immediately), but
          // this used to also `await runLoop(...)` for every REMAINING step
          // in the plan before responding — the exact "approval result
          // propagation is slow" complaint. Persist the post-decision state
          // now (recordStep already did this for the executed step) and
          // respond immediately; any remaining steps continue in the
          // background and keep persisting their own progress, same as the
          // initial session-kind path above.
          await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: session }, { upsert: true });
          void (async () => {
            try {
              const tools2 = await liveRegistry();
              await runLoop(session, role, tools2);
            } catch (e) {
              ctx.log.error({ err: e, runtimeSessionId: session.runtimeSessionId }, 'background post-approval runLoop failed');
              await opSessions.updateOne({ runtimeSessionId: session.runtimeSessionId }, { $set: { status: 'failed', reportSummary: 'Internal error resuming the session — see server logs.', completedAt: nowIso() } }).catch(() => { /* nothing more we can do */ });
            }
          })();
          return success({ decided: approve ? 'approved' : 'rejected', session });
        }
        return success({ decided: approve ? 'approved' : 'rejected', session });
      });

}
