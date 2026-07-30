/**
 * Google Calendar & Tasks routes (D-192b).
 *
 * The OAuth callback is the one route here that CANNOT be behind the internal
 * guard: Google's browser redirect carries no header of ours. It is protected
 * instead by the `state` parameter, which is minted here, stored, and compared
 * on return — the standard CSRF defence for the authorization-code flow.
 * Everything else is guarded like the rest of the control plane.
 */
import { randomBytes } from 'node:crypto';
import {
  googleAvailability, googleConfig, buildAuthUrl, exchangeCode, fetchAccountEmail,
  storeGrant, getGrant, deleteGrant, vaultAvailability,
  syncAll, syncCalendarList, listCalendars, readAgenda, readTasks, syncStates,
  ensureAosCalendar, createEvent, createTask, classifyWrite,
  failure, success, ERROR_CODES,
} from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, FastifyReplyLike } from './deps.js';

/** Single-operator mode, like the rest of the control plane today. */
const OWNER = 'owner';

/**
 * Pending OAuth states, in memory with a short TTL.
 *
 * Deliberately not persisted: a state is single-use and lives for seconds, and
 * a gateway restart mid-consent should invalidate it rather than leave a
 * replayable token in the database.
 */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60_000;

function mintState(): string {
  const state = randomBytes(24).toString('base64url');
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
  return state;
}

function consumeState(state: string): boolean {
  const exp = pendingStates.get(state);
  if (!exp) return false;
  pendingStates.delete(state);      // single use, always
  return exp >= Date.now();
}

export function registerCalendarRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { guard, deny } = deps;

  const handle = async (reply: FastifyReplyLike, fn: () => Promise<unknown>) => {
    try {
      return success(await fn());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "not connected" is a state, not a fault — the UI shows a connect button.
      const code = /not_connected|grant_revoked/.test(message) ? 409 : 500;
      return reply.code(code).send(failure(ERROR_CODES.INTERNAL, message));
    }
  };

  /* ------------------------------------------------------------- status */

  app.get('/v1/calendar/status', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const oauth = googleAvailability();
    const vault = vaultAvailability();
    const grant = oauth.configured && vault.configured ? await getGrant(OWNER) : null;
    return success({
      /** Exactly what is missing, so the UI never says a generic "error". */
      setup: {
        oauthConfigured: oauth.configured,
        oauthMissing: oauth.missing,
        vaultConfigured: vault.configured,
        vaultReason: vault.reason,
      },
      connected: Boolean(grant && !grant.revokedAt),
      accountEmail: grant?.accountEmail ?? '',
      scopes: grant?.scopes ?? [],
      revokedAt: grant?.revokedAt ?? null,
      lastError: grant?.lastError ?? '',
      calendars: grant ? await listCalendars(OWNER) : [],
      sync: grant ? await syncStates(OWNER) : [],
    });
  });

  /* -------------------------------------------------------------- oauth */

  app.get('/v1/calendar/oauth/start', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const cfg = googleConfig();
    if (!cfg) return reply.code(501).send(failure(ERROR_CODES.VALIDATION, googleAvailability().reason));
    const vault = vaultAvailability();
    if (!vault.configured) return reply.code(501).send(failure(ERROR_CODES.VALIDATION, vault.reason));
    return success({ url: buildAuthUrl(cfg, mintState()) });
  });

  /**
   * Google redirects the BROWSER here. No internal header can be present, so
   * `state` is the authentication: minted above, single-use, time-boxed.
   */
  app.get('/v1/calendar/oauth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const dash = process.env.FACTORY_PUBLIC_URL || 'http://localhost:4100';
    const back = (status: string) => reply.redirect(`${dash}/calendar?connect=${encodeURIComponent(status)}`);

    if (q.error) return back(q.error);
    if (!q.code || !q.state) return back('missing_code');
    if (!consumeState(q.state)) return back('bad_state');

    const cfg = googleConfig();
    if (!cfg) return back('not_configured');

    try {
      const tok = await exchangeCode(cfg, q.code);
      const email = await fetchAccountEmail(tok.access_token);
      await storeGrant({
        actorId: OWNER,
        refreshToken: tok.refresh_token ?? '',
        accessToken: tok.access_token,
        expiresInSec: tok.expires_in,
        scopes: (tok.scope ?? '').split(' ').filter(Boolean),
        accountEmail: email,
      });
      // First sync immediately: an empty calendar page after connecting looks
      // broken even when it is merely unsynced.
      await syncAll(OWNER).catch(() => undefined);
      return back('ok');
    } catch (err) {
      return back(err instanceof Error ? err.message.slice(0, 80) : 'failed');
    }
  });

  app.post('/v1/calendar/disconnect', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({ removed: await deleteGrant(OWNER) }));
  });

  /* --------------------------------------------------------------- sync */

  app.post('/v1/calendar/sync', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({ results: await syncAll(OWNER) }));
  });

  app.post('/v1/calendar/calendars/refresh', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({ calendars: await syncCalendarList(OWNER) }));
  });

  /* --------------------------------------------------------------- read */

  app.get('/v1/calendar/agenda', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { from?: string; to?: string; limit?: string };
    const from = q.from ?? new Date().toISOString().slice(0, 10);
    const to = q.to ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
    return handle(reply, async () => ({
      events: await readAgenda({ actorId: OWNER, fromIso: from, toIso: to, limit: Number(q.limit ?? 250) }),
    }));
  });

  app.get('/v1/calendar/tasks', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const q = req.query as { includeCompleted?: string };
    return handle(reply, async () => ({
      tasks: await readTasks(OWNER, { includeCompleted: q.includeCompleted === 'true' }),
    }));
  });

  /* -------------------------------------------------------------- write */

  app.post('/v1/calendar/events', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = req.body as {
      summary?: string; start?: string; end?: string; description?: string;
      location?: string; calendarId?: string; attendees?: string[]; withMeet?: boolean;
      timeZone?: string;
    };
    if (!body?.summary || !body.start || !body.end) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'summary, start and end are required'));
    }

    return handle(reply, async () => {
      const target = body.calendarId
        ? (await listCalendars(OWNER)).find((c) => c.calendarId === body.calendarId) ?? null
        : await ensureAosCalendar(OWNER);

      /* The same policy the agent tools use. Enforced here too, because the
       * gateway is reachable by anything holding an internal token — a rule
       * that only exists in one caller is not a rule. */
      const verdict = classifyWrite({
        op: 'create', calendar: target, hasAttendees: Boolean(body.attendees?.length),
      });
      if (verdict.sensitivity === 'approval' && !(req.headers['x-factory-approved'] === 'true')) {
        return { requiresApproval: true, reason: verdict.reason, calendarId: target?.calendarId ?? null };
      }

      const created = await createEvent({
        actorId: OWNER,
        calendarId: target?.calendarId,
        summary: body.summary!,
        description: body.description,
        location: body.location,
        start: body.start!,
        end: body.end!,
        timeZone: body.timeZone,
        attendees: body.attendees,
        withMeet: body.withMeet,
      });
      await syncAll(OWNER).catch(() => undefined);
      return { event: created, requiresApproval: false };
    });
  });

  app.post('/v1/calendar/tasks', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = req.body as { title?: string; notes?: string; due?: string };
    if (!body?.title) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'title is required'));
    return handle(reply, async () => {
      // Tasks live in the owner's own list and carry no invitations, so they
      // are the one write that is unattended by nature.
      const created = await createTask({ actorId: OWNER, title: body.title!, notes: body.notes, due: body.due });
      return { task: created };
    });
  });
}
