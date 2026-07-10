/**
 * Gateway routes — voice group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, EVENT_TYPES, INTERNAL_TOKEN_HEADER, VOICE_GUARDRAILS, buildDiagnostics, buildEvidence, buildOperationPlan, canAccess, failure, genId, legacyRoleToAuthContext, normalizeUtterance, nowIso, parseDokployTargets, routeUtterance, setStep, success } from '@factory/shared';
import type { Tenant, ToolProposal, VoicePermission, VoiceSession, VoiceToolCall } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerVoiceRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    dokploySync,
    env,
    ctx,
    guard,
    deny,
    clientIp,
    userAgent,
    declaredRole,
    writeAudit,
    writeSecEvent,
    rateLimited,
    enforce,
    isSafeMode,
    saveOp,
    runVerification,
    dokployClient,
    voiceServiceUrl,
    createKernelTask,
    tasks,
    approvals,
    events,
    evidence,
    incidents,
    intelligenceReports,
    operationPlans,
    voiceSessions,
    voiceMessages,
    voiceToolCalls,
    voicePermissions,
    voiceMemories,
    evidenceCol,
  } = deps;

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
            const dokploy = dokployClient ? (dokploySync.lastAt ? `synced ${dokploySync.lastAt}` : 'connected, not yet synced') : 'not configured';
            resultSummary = `System check: ${serviceCount >= 0 ? `${serviceCount} services registered` : 'registry unreachable'}; ${taskCount} tasks (${runningTasks} active); ${apprCount} approvals pending; ${openInc} open incidents; safe mode ${safeNow ? 'ON' : 'off'}; Dokploy ${dokploy}.`;
            const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: null, summary: `Voice system check: ${resultSummary}`, data: { serviceCount, taskCount, runningTasks, pendingApprovals: apprCount, openIncidents: openInc, safeMode: safeNow } });
            await evidenceCol.insertOne(ev); evidenceIds.push(ev.evidenceId);
          } else if (tc.toolName === 'run_learning_analysis') { linkedTaskId = await createKernelTask('Analyze system history and recommend improvements', ['learning', 'voice']); resultSummary = `Learning analysis task ${linkedTaskId} started`; }
          else if (tc.toolName === 'run_security_check') { linkedTaskId = await createKernelTask('Run production security hardening check.', ['security', 'voice']); resultSummary = `Security check task ${linkedTaskId} started`; }
          else if (tc.toolName === 'run_research_plan') { linkedTaskId = await createKernelTask(args.goal ?? 'Research current best practices and create an improvement plan.', ['research', 'voice']); resultSummary = `Research task ${linkedTaskId} started`; }
          else if (tc.toolName === 'sync_dokploy_targets') {
            if (!dokployClient) resultSummary = 'Dokploy API not configured — manual confirmation remains available.';
            else { const pr = await dokployClient.listProjects(); resultSummary = pr.ok ? `Synced (${parseDokployTargets(pr.data).length} targets)` : `Dokploy sync failed: ${pr.error}`; if (pr.ok) dokploySync.lastAt = nowIso(); }
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
}
