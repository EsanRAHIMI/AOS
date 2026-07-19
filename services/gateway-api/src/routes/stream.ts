/**
 * Gateway routes — owner stream + heartbeat group (CIN-2 first slice, D-180).
 *
 * This is the "Jarvis leaves chatbot mode" surface:
 * - `GET /v1/stream/owner` — ONE persistent SSE channel the dashboard keeps
 *   open: presence snapshot, live proactive events, heartbeat pings. Mongo is
 *   the truth (poll-based fan-out like the jarvis turn stream) so it is
 *   multi-instance safe without new infrastructure.
 * - `POST /v1/heartbeat/run` — trigger one pulse now (owner button / ops).
 * - Background pulse: an in-process interval started once per gateway boot
 *   (JARVIS_HEARTBEAT_INTERVAL_MS, default 5 min, '0' disables). Fail-soft:
 *   a pulse error is logged to the run record path, never crashes the
 *   gateway. Moving this to a BullMQ repeatable job is the CIN-2 completion
 *   step (documented in docs/cin-v2/master-plan.md).
 */
import {
  ESAN_USER_ID, failure, success, ERROR_CODES,
  runHeartbeatOnce, listProactiveEvents, setProactiveEventStatus, lastHeartbeat,
} from '@factory/shared';
import type { HeartbeatActor } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req } from './deps.js';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function registerStreamRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { ctx, guard, deny, resolveAuth, declaredRole } = deps;

  const publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => ctx.publisher.publish(e);

  const actorFor = (req: Req): HeartbeatActor => {
    const auth = resolveAuth(req);
    return { actorId: auth.primaryUserId ?? declaredRole(req), scope: 'user', tenantId: auth.activeTenantId ?? null };
  };
  const ownerActor: HeartbeatActor = { actorId: ESAN_USER_ID, scope: 'user', tenantId: null };

  /* --------------------------- heartbeat pulse --------------------------- */

  app.post('/v1/heartbeat/run', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    try {
      const result = await runHeartbeatOnce(actorFor(req), { publish });
      return success({ heartbeatId: result.run.heartbeatId, checks: result.run.checks, created: result.created.length, durationMs: result.run.durationMs });
    } catch (e) {
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, e instanceof Error ? e.message : 'heartbeat failed'));
    }
  });

  app.get('/v1/heartbeat/last', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return success({ last: await lastHeartbeat(actorFor(req)) });
  });

  /* -------------------------- proactive events --------------------------- */

  app.get('/v1/proactive', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { status?: string; limit?: string };
    const statuses = q.status ? [q.status as never] : undefined;
    return success({ events: await listProactiveEvents(actorFor(req), { statuses, limit: q.limit ? Number(q.limit) : undefined }) });
  });

  app.post('/v1/proactive/:id/status', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const { id } = req.params as { id: string };
    const status = String((req.body as { status?: string } | null)?.status ?? '');
    if (!['seen', 'acked', 'dismissed'].includes(status)) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'status must be seen|acked|dismissed'));
    }
    const ok = await setProactiveEventStatus(actorFor(req), id, status as never);
    return ok ? success({ eventId: id, status }) : reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, `event ${id} not found`));
  });

  /* --------------------------- the owner stream --------------------------- */

  app.get('/v1/stream/owner', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const actor = actorFor(req);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Presence snapshot: last pulse + currently open proactive events.
    const [last, open] = await Promise.all([
      lastHeartbeat(actor),
      listProactiveEvents(actor, { limit: 20 }),
    ]);
    send('presence', {
      at: new Date().toISOString(),
      lastHeartbeatAt: last?.at ?? null,
      openEvents: open.length,
    });
    for (const e of [...open].reverse()) send('proactive', e);

    // Live fan-out: poll Mongo for events newer than the cursor. 2.5s cadence,
    // ping every 15s so proxies keep the socket open. Client (EventSource)
    // auto-reconnects; we cap a single connection at 30 minutes.
    let cursor = open[0]?.createdAt ?? new Date().toISOString();
    let closed = false;
    req.raw.on('close', () => { closed = true; });
    const startedAt = Date.now();
    let lastPing = Date.now();
    while (!closed && Date.now() - startedAt < 30 * 60_000) {
      await new Promise((r) => setTimeout(r, 2500));
      if (closed) break;
      try {
        const fresh = await listProactiveEvents(actor, { afterIso: cursor, limit: 20 });
        for (const e of [...fresh].reverse()) { send('proactive', e); cursor = e.createdAt > cursor ? e.createdAt : cursor; }
        if (Date.now() - lastPing > 15_000) { send('ping', { at: new Date().toISOString() }); lastPing = Date.now(); }
      } catch {
        break; // DB hiccup — end the stream; the client reconnects.
      }
    }
    send('stream.end', { reconnect: true });
    reply.raw.end();
  });

  /* ----------------------- background pulse (boot) ----------------------- */

  const intervalMs = Number(process.env.JARVIS_HEARTBEAT_INTERVAL_MS ?? 300_000);
  if (!heartbeatTimer && Number.isFinite(intervalMs) && intervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      void runHeartbeatOnce(ownerActor, { publish }).catch(() => {
        /* fail-soft: a failed pulse must never take the gateway down */
      });
    }, intervalMs);
    // Never keep the process alive just for the pulse.
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }
}
