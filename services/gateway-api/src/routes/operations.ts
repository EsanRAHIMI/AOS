/**
 * Gateway routes — operations group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, EVENT_TYPES, SERVICE_IDS, buildDiagnostics, buildEvidence, buildManualInstructions, buildOperationPlan, buildSnapshot, canAutoExecute, classifyOperation, dokployConfigFromEnv, failure, genId, isProtectedCore, mapAosServices, nowIso, parseDokployTargets, setStep, success } from '@factory/shared';
import type { Approval, DokployTarget, OperationType } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerOperationsRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
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
    executeViaApi,
    runVerification,
    TERMINAL,
    dokployClient,
    dokployApiConfigured,
    dokploySync,
    evidence,
    operationPlans,
    dokployTargets,
    deploymentSnapshots,
    dokployDiagnostics,
    evidenceCol,
  } = deps;

      app.get('/v1/operations', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await operationPlans.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });
      app.get('/v1/operations/active', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(20).toArray();
        // Only a genuinely in-flight (non-terminal) operation is "active". Terminal
        // ones (completed/failed/rolled_back/cancelled) must never occupy the panel.
        const active = rows.find((p) => !TERMINAL.has(p.status)) ?? null;
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
        return success({ configured: dokployApiConfigured, connection, lastSyncedAt: dokploySync.lastAt, apiTargetCount: targetCount });
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
        dokploySync.lastAt = nowIso();
        return success({ synced: out.length, lastSyncedAt: dokploySync.lastAt, note: out.length === 0 ? 'Connected, but no applications parsed from this Dokploy version — run diagnostics and confirm targets manually.' : undefined });
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

      // Cancel / discard an operation from ANY non-terminal state (e.g. stuck in
      // waiting_target_selection). Cancelling is a de-escalation: it is never
      // blocked by safe mode and is idempotent. Completed operations cannot be
      // cancelled — only in-flight ones. In-flight steps are marked skipped;
      // already-done steps stay as an honest record of what ran.
      app.post<{ Params: { id: string }; Body: { reason?: string } }>('/v1/operations/:id/cancel', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'operation_cancel')) return reply;
        if (await enforce('decideOperation', req, reply)) return reply;
        const role = declaredRole(req);
        const plan = await operationPlans.findOne({ operationPlanId: req.params.id });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'operation not found'));
        if (plan.status === 'cancelled') return success(plan); // idempotent
        if (TERMINAL.has(plan.status)) return reply.code(409).send(failure(ERROR_CODES.CONFLICT, `operation is ${plan.status} — a finished operation cannot be cancelled`));
        const prev = plan.status;
        const reason = (String(req.body?.reason ?? '').trim() || 'Cancelled by operator').slice(0, 200);
        plan.steps = plan.steps.map((s) =>
          s.status === 'active' || s.status === 'waiting' || s.status === 'manual_required'
            ? { ...s, status: 'skipped' as const, message: reason, actor: role, at: nowIso() }
            : s,
        );
        plan.status = 'cancelled';
        await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'operation_cancelled', targetType: 'operation_plan', targetId: plan.operationPlanId, reason, after: { previousStatus: prev } });
        await saveOp(plan);
        return success(plan);
      });

}
