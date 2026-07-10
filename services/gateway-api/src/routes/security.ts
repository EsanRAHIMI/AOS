/**
 * Gateway routes — security group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { EVENT_TYPES, auditEnvironment, buildSecurityCheck, failure, nowIso, success } from '@factory/shared';
import type { RoleName, SecurityEvent } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerSecurityRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    ctx,
    guard,
    deny,
    clientIp,
    userAgent,
    declaredRole,
    writeAudit,
    writeSecEvent,
    enforce,
    envAuditInput,
    isSafeMode,
    SAFE_MODE_SETTING,
    mutationLimiter,
    events,
    securityChecks,
    securityEvents,
    systemSettings,
  } = deps;


      app.get('/v1/security/safe-mode', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success({ enabled: await isSafeMode() });
      });
      app.post<{ Body: { enabled?: boolean } }>('/v1/security/safe-mode', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('setSafeMode', req, reply)) return reply;
        const enabled = Boolean(req.body?.enabled);
        await systemSettings.updateOne({ settingId: SAFE_MODE_SETTING }, { $set: { value: enabled, updatedAt: nowIso() } }, { upsert: true });
        const role = declaredRole(req);
        await writeAudit({ actorType: 'human', actorId: role, role, action: enabled ? 'safe_mode_enabled' : 'safe_mode_disabled', targetType: 'safe_mode', targetId: SAFE_MODE_SETTING, after: { enabled } });
        await writeSecEvent({ eventType: EVENT_TYPES.SAFE_MODE_CHANGED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: 'safe_mode', result: 'info', riskLevel: enabled ? 'high' : 'low', detail: `safe mode ${enabled ? 'enabled' : 'disabled'}` });
        await ctx.publisher.publish({ type: EVENT_TYPES.SAFE_MODE_CHANGED, taskId: null, payload: { enabled, message: `Safe mode ${enabled ? 'ENABLED' : 'disabled'}` } });
        return success({ enabled });
      });

      app.get('/v1/security/env', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const audit = auditEnvironment(envAuditInput());
        return success({ ...audit, safeMode: await isSafeMode() });
      });

      app.post('/v1/security/check', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('runSecurityCheck', req, reply)) return reply;
        const audit = auditEnvironment(envAuditInput());
        const check = buildSecurityCheck('system', audit, await isSafeMode());
        await securityChecks.insertOne(check);
        const role = declaredRole(req);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'security_check_run', targetType: 'security_check', targetId: check.checkId, after: { passed: check.passed, riskLevel: check.riskLevel } });
        await writeSecEvent({ eventType: EVENT_TYPES.SECURITY_CHECK_COMPLETED, actorId: role, role, ip: clientIp(req), userAgent: userAgent(req), target: 'system', result: check.passed ? 'success' : 'failure', riskLevel: check.riskLevel, detail: `security check ${check.passed ? 'passed' : 'found issues'} (${check.riskLevel})` });
        await ctx.publisher.publish({ type: EVENT_TYPES.SECURITY_CHECK_COMPLETED, taskId: null, payload: { checkId: check.checkId, passed: check.passed, riskLevel: check.riskLevel, message: `Security check ${check.passed ? 'passed' : 'found issues'}` } });
        return success(check);
      });
      app.get('/v1/security/checks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await securityChecks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.get<{ Querystring: { limit?: string } }>('/v1/security/events', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        return success(await securityEvents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray());
      });
      app.get('/v1/security/rate-limits', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success({ buckets: mutationLimiter.snapshot() });
      });
      // The dashboard reports auth events (login/logout/denials) here. Trusted by token.
      app.post<{ Body: { eventType: string; actorId?: string; role?: string; result?: SecurityEvent['result']; target?: string; detail?: string; riskLevel?: SecurityEvent['riskLevel'] } }>('/v1/security/event', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const b = req.body ?? { eventType: 'unknown' };
        const evt = await writeSecEvent({ eventType: b.eventType, actorId: b.actorId ?? 'anonymous', role: b.role ?? null, ip: clientIp(req), userAgent: userAgent(req), target: b.target ?? '', result: b.result ?? 'info', riskLevel: b.riskLevel ?? 'low', detail: b.detail ?? '' });
        // Mirror denials/failures into the audit trail for a single governance record.
        if (b.result === 'denied' || b.result === 'failure') {
          await writeAudit({ actorType: b.role === 'agent' ? 'agent' : 'human', actorId: b.actorId ?? 'anonymous', role: (['owner', 'operator', 'viewer', 'agent'] as string[]).includes(b.role ?? '') ? (b.role as RoleName) : null, action: `security_${b.eventType}`, targetType: 'security', targetId: b.target ?? b.eventType, reason: b.detail ?? '' });
        }
        return success(evt);
      });

}
