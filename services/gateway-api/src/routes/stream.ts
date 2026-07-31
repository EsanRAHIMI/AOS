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
  listHappenings, HappeningCategory, assessReadiness,
  readAttentionContext, judgeInterrupt, listAttentionDecisions, dueHeldItems,
  deliverBriefingIfDue, currentBriefingMoment,
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

  /* ---------------------------- happening feed ---------------------------- */

  /**
   * The owner-facing feed of everything that actually happened (D-208).
   *
   * A projection, not a log: see shared/src/happenings for why this reads the
   * governed ledger instead of adding a write path of its own. `afterIso`
   * makes it incremental so the stage can poll cheaply if SSE is unavailable.
   */
  app.get('/v1/jarvis/happenings', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { afterIso?: string; limit?: string; categories?: string };
    const categories = q.categories
      ? q.categories.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;
    // A bad category name is a client bug, not a reason to serve a silently
    // narrower feed — fail loudly rather than showing the owner less.
    const parsed = categories?.map((c) => HappeningCategory.safeParse(c));
    const bad = categories?.find((_, i) => !parsed?.[i]?.success);
    if (bad) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, `unknown category '${bad}'`));
    const items = await listHappenings(actorFor(req), {
      afterIso: q.afterIso,
      limit: q.limit ? Number(q.limit) : undefined,
      categories: categories as never,
    });
    return success({ happenings: items, generatedAt: new Date().toISOString() });
  });

  /**
   * What the system still needs from the owner (D-208).
   *
   * Read-only and derived entirely from stored state, so it is safe to poll
   * and impossible to get wrong by being stale — a gap that has been fixed
   * simply stops being reported on the next call.
   */
  app.get('/v1/jarvis/readiness', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const gaps = await assessReadiness(actorFor(req), process.env);
    return success({
      gaps,
      blocking: gaps.filter((g) => g.severity === 'blocking').length,
      generatedAt: new Date().toISOString(),
    });
  });

  /* ------------------------------- attention ------------------------------ */

  /**
   * What Jarvis thinks the owner is doing, and what it has decided to say or
   * not say (D-209).
   *
   * The `decisions` list is the point: it is the only place the owner can
   * find out why they were NOT told something. A gate without this endpoint
   * is a gate nobody can hold accountable.
   */
  app.get('/v1/jarvis/attention', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { focused?: string; limit?: string };
    const actor = actorFor(req);
    const ctx = await readAttentionContext(actor, { focused: q.focused === '1' });
    const [decisions, held, moment] = await Promise.all([
      listAttentionDecisions(actor, { limit: q.limit ? Number(q.limit) : 30 }),
      dueHeldItems(actor),
      currentBriefingMoment(),
    ]);
    return success({ context: ctx, decisions, held, moment });
  });

  /**
   * Ask the gate about ONE candidate without recording anything.
   *
   * The dashboard uses this before speaking an alert it generated locally
   * (the pre-event reminder), so the browser and the kernel apply the SAME
   * judgement instead of the client having a private rule about when it is
   * acceptable to talk.
   */
  app.post<{ Body: { subjectId?: string; subjectKind?: string; headline?: string; weight?: number; timeCritical?: boolean; focused?: boolean } }>(
    '/v1/jarvis/attention/judge',
    async (req, reply) => {
      if (!guard(req)) return deny(reply);
      const b = req.body ?? {};
      if (!b.subjectId) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'subjectId is required'));
      const actor = actorFor(req);
      const ctx = await readAttentionContext(actor, { focused: Boolean(b.focused) });
      const record = await judgeInterrupt(actor, {
        subjectId: b.subjectId,
        subjectKind: b.subjectKind ?? 'client_alert',
        headline: b.headline ?? '',
        weight: typeof b.weight === 'number' ? b.weight : 0.6,
        timeCritical: Boolean(b.timeCritical),
      }, ctx);
      return success({ decision: record });
    },
  );

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
    const [last, open, recent] = await Promise.all([
      lastHeartbeat(actor),
      listProactiveEvents(actor, { limit: 20 }),
      listHappenings(actor, { limit: 60 }),
    ]);
    send('presence', {
      at: new Date().toISOString(),
      lastHeartbeatAt: last?.at ?? null,
      openEvents: open.length,
    });
    for (const e of [...open].reverse()) send('proactive', e);

    /* D-208 — the backlog arrives as ONE frame, not 60 `happening` events.
     * Streaming them individually would make the stage animate the last hour
     * of history at the owner on every reconnect; a snapshot renders settled
     * and only genuinely new cards get the surface-and-dock animation. */
    send('happenings.snapshot', { items: recent });
    let happeningCursor = recent[0]?.at ?? new Date().toISOString();
    // Ids already sent, so a row whose `at` ties the cursor is never repeated.
    // Bounded to the snapshot window — anything older cannot come back.
    let seenIds = new Set(recent.map((h) => h.happeningId));

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

        /* Happenings tick on the same 2.5s beat. The cursor is inclusive-safe:
         * we ask for rows at-or-after it and drop ids we already sent, because
         * a turn and its first tool call routinely share a millisecond and an
         * exclusive `$gt` would silently swallow the second one. */
        const nextHappenings = await listHappenings(actor, { afterIso: happeningCursor, limit: 40 });
        const unseen = nextHappenings.filter((h) => !seenIds.has(h.happeningId));
        for (const h of [...unseen].reverse()) {
          send('happening', h);
          if (h.at > happeningCursor) happeningCursor = h.at;
        }
        if (unseen.length) {
          for (const h of unseen) seenIds.add(h.happeningId);
          // Keep the dedupe set from growing without bound on a long-lived
          // connection: only ids at the current cursor can still collide.
          if (seenIds.size > 400) {
            seenIds = new Set([...nextHappenings, ...unseen].filter((h) => h.at >= happeningCursor).map((h) => h.happeningId));
          }
        }

        /* D-209 — a briefing becomes due at a moment in the owner's day, not
         * on a timer, so the stream checks for one on each tick. It is
         * idempotent (`alreadyDelivered`), which is what makes it safe to ask
         * this often and safe for two open tabs to ask at once. */
        const briefing = await deliverBriefingIfDue(actor);
        if (briefing) send('briefing', briefing);

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
