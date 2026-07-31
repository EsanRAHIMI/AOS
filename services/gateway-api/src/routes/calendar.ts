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
  rememberOAuthState, consumeOAuthState,
  CALENDAR_ACTOR_ID, syncAll, syncFirstPaint, syncCalendarList, listCalendars, readAgenda, readTasks, syncStates,
  ensureAosCalendar, createEvent, createTask, classifyWrite, purgeMirror, setCalendarEnabled,
  saveEventNote, readEventNotes, deleteEventNote,
  getPreferences, setPreferences, PreferencesPatchSchema, diagnoseRange, backfillRange,
  failure, success, ERROR_CODES,
} from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, FastifyReplyLike } from './deps.js';

/** Single-operator mode, like the rest of the control plane today. */
/* Imported, not re-declared (D-195b): this literal existing in two places is
 * exactly how Jarvis ended up reading a grant that was never there. */
const OWNER = CALENDAR_ACTOR_ID;

/**
 * The consent landing page (D-192d).
 *
 * The callback used to answer with a bare 302. A redirect that fails — a
 * blocked navigation, an embedded browser view, a wrong base URL — leaves the
 * owner stranded on Google's page with no idea whether it worked, which is
 * exactly what happened. An OAuth callback should always render something the
 * human can read and act on; the automatic redirect is a convenience layered
 * on top, not the only path back.
 */
function landing(dash: string, ok: boolean, title: string, detail: string): string {
  const target = `${dash}/calendar?connect=${ok ? 'ok' : encodeURIComponent(title)}`;
  const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2;url=${esc(target)}">
<title>${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070a12;color:#eef1f8;
       font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
  .c{max-width:520px;padding:34px 30px;border-radius:22px;text-align:right;
     background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02) 44%),
                linear-gradient(180deg,rgba(22,28,46,.72),rgba(10,14,24,.88));
     border:1px solid rgba(255,255,255,.14);
     box-shadow:0 1px 0 0 rgba(255,255,255,.22) inset,0 24px 70px -18px rgba(0,0,0,.8)}
  h1{margin:0 0 10px;font-size:19px}
  p{margin:0 0 18px;font-size:13px;line-height:1.9;color:#97a0b8}
  a{display:inline-block;padding:10px 18px;border-radius:999px;text-decoration:none;color:#eef1f8;
    border:1px solid rgba(110,168,255,.45);background:rgba(110,168,255,.16);font-size:13px}
  .d{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:8px;
     background:${ok ? '#45e0a8' : '#ff6b81'}}
</style>
<div class="c">
  <h1><span class="d"></span>${esc(title)}</h1>
  <p>${esc(detail)}</p>
  <a href="${esc(target)}">بازگشت به داشبورد</a>
</div>`;
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
    const state = randomBytes(24).toString('base64url');
    await rememberOAuthState(state);
    return success({ url: buildAuthUrl(cfg, state) });
  });

  /**
   * Google redirects the BROWSER here. No internal header can be present, so
   * `state` is the authentication: minted above, single-use, time-boxed.
   */
  app.get('/v1/calendar/oauth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const dash = (process.env.FACTORY_PUBLIC_URL || 'http://localhost:4100').trim().replace(/\/+$/, '');
    const page = (ok: boolean, title: string, detail: string) =>
      reply.code(200).header('content-type', 'text/html; charset=utf-8').send(landing(dash, ok, title, detail));

    // Logged unconditionally: when a connect goes wrong, the first question is
    // always "did Google actually come back to us?".
    deps.ctx.log.info({ hasCode: Boolean(q.code), hasState: Boolean(q.state), error: q.error ?? '' }, 'calendar oauth callback');

    if (q.error) return page(false, 'گوگل اجازه نداد', `${q.error} — اگر access_denied است، ایمیل خود را در Test users اضافه کنید یا اپ را Publish کنید.`);
    if (!q.code || !q.state) return page(false, 'پاسخ ناقص از گوگل', 'کد یا state برنگشت. دوباره از صفحهٔ تقویم شروع کنید.');
    if (!(await consumeOAuthState(q.state))) {
      return page(false, 'درخواست معتبر نبود', 'این درخواست قبلاً استفاده شده یا منقضی شده است. یک‌بار دیگر «اتصال به گوگل» را بزنید.');
    }

    const cfg = googleConfig();
    if (!cfg) return page(false, 'تنظیم نشده', googleAvailability().reason);

    try {
      const tok = await exchangeCode(cfg, q.code);
      const email = await fetchAccountEmail(tok.access_token);
      const grant = await storeGrant({
        actorId: OWNER,
        refreshToken: tok.refresh_token ?? '',
        accessToken: tok.access_token,
        expiresInSec: tok.expires_in,
        scopes: (tok.scope ?? '').split(' ').filter(Boolean),
        accountEmail: email,
      });
      /* Connecting a DIFFERENT Google account must not leave the previous
       * account's events in the mirror — the page would report this account as
       * connected while showing someone else's calendar. */
      if (grant.accountChanged) {
        const purged = await purgeMirror(OWNER);
        deps.ctx.log.warn({ account: email, purged }, 'google account changed — local mirror purged');
      }

      // First sync immediately: an empty calendar page right after connecting
      // looks broken even when it is merely unsynced.
      const results = await syncFirstPaint(OWNER).catch(() => []);
      void syncAll(OWNER).catch(() => undefined);
      const total = results.reduce((n, r) => n + r.upserted, 0);
      return page(true, 'اتصال برقرار شد', `${email || 'حساب گوگل'} وصل شد و ${total} مورد همگام‌سازی شد.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed';
      deps.ctx.log.error({ err }, 'calendar oauth exchange failed');
      return page(false, 'تبادل توکن ناموفق بود', message.slice(0, 200));
    }
  });

  /**
   * Server-to-server code exchange (D-193c).
   *
   * The browser used to be sent to the GATEWAY's callback on port 4101 — a
   * different origin from the app, and an API server rather than a web app.
   * Every way that can go wrong (a blocked cross-port navigation, an embedded
   * view, a proxy, a browser that will not render a bare API response) leaves
   * the owner stranded on Google's page. It did, repeatedly.
   *
   * The redirect now lands on the DASHBOARD, same origin as the app, and the
   * dashboard calls this route server-side. The browser never touches the
   * gateway, and the return trip is an ordinary in-app navigation that cannot
   * fail to land.
   */
  app.post('/v1/calendar/oauth/exchange', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = req.body as { code?: string; state?: string };
    if (!body?.code || !body.state) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'code and state are required'));
    }
    if (!(await consumeOAuthState(body.state))) {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'bad_state'));
    }
    const cfg = googleConfig();
    if (!cfg) return reply.code(501).send(failure(ERROR_CODES.VALIDATION, googleAvailability().reason));

    return handle(reply, async () => {
      const tok = await exchangeCode(cfg, body.code!);
      const email = await fetchAccountEmail(tok.access_token);
      const grant = await storeGrant({
        actorId: OWNER,
        refreshToken: tok.refresh_token ?? '',
        accessToken: tok.access_token,
        expiresInSec: tok.expires_in,
        scopes: (tok.scope ?? '').split(' ').filter(Boolean),
        accountEmail: email,
      });
      if (grant.accountChanged) {
        const purged = await purgeMirror(OWNER);
        deps.ctx.log.warn({ account: email, purged }, 'google account changed — local mirror purged');
      }

      /* The first sync runs in the BACKGROUND, deliberately.
       *
       * It used to be awaited here, and that is what produced `exchange_failed`
       * on a connection that had actually succeeded: a first sync walks every
       * calendar and can take far longer than the dashboard's 12s gateway
       * timeout, so the caller gave up and reported failure while the grant was
       * already stored and the sync was still running. The exchange is the
       * thing the owner is waiting on; the sync is not. */
      /* Staged (D-194): the four month windows are awaited — they are bounded
       * and quick, and they are what the owner is about to look at. The
       * unbounded tokenised walk then runs behind them. */
      const primed = await syncFirstPaint(OWNER).catch(() => []);
      void syncAll(OWNER)
        .then((r) => deps.ctx.log.info({ synced: r.reduce((n, x) => n + x.upserted, 0) }, 'calendar initial sync done'))
        .catch((err) => deps.ctx.log.error({ err }, 'calendar initial sync failed'));

      return {
        accountEmail: email,
        syncStarted: true,
        primed: primed.reduce((n, r) => n + r.upserted, 0),
      };
    });
  });

  app.post('/v1/calendar/disconnect', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    // Disconnecting must take the data with it, not just the token.
    return handle(reply, async () => {
      const removed = await deleteGrant(OWNER);
      const purged = await purgeMirror(OWNER);
      return { removed, purged };
    });
  });

  /* -------------------------------------------------- owner preferences */
  /* Lives on the calendar router because timezone is its most consequential
   * setting, but it is system-wide (D-202): language, currency and calendar
   * system are read by every page and by Jarvis. */

  app.get('/v1/settings/preferences', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({ preferences: await getPreferences() }));
  });

  app.put<{ Body: Record<string, unknown> }>('/v1/settings/preferences', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const parsed = PreferencesPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return failure(ERROR_CODES.VALIDATION, parsed.error.message);
    try {
      return success({ preferences: await setPreferences(parsed.data) });
    } catch (err) {
      // A bad timezone must fail here, not silently inside a formatter later.
      return failure(ERROR_CODES.VALIDATION, err instanceof Error ? err.message : 'invalid');
    }
  });

  /* -------------------------------------------------------------- notes */
  /* Notes live in AOS, never in the Google event (D-198): editing the owner's
   * description would show the note to every guest and fight the sync mirror.
   * The trade is stated in the UI — these do not appear on their phone. */

  app.get<{ Querystring: { eventIds?: string } }>('/v1/calendar/notes', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({
      notes: await readEventNotes(OWNER, String(req.query.eventIds ?? '').split(',').filter(Boolean)),
    }));
  });

  app.post<{ Body: { calendarId?: string; eventId?: string; body?: string; noteId?: string } }>(
    '/v1/calendar/notes',
    async (req, reply) => {
      if (!guard(req)) return deny(reply);
      const eventId = String(req.body?.eventId ?? '');
      if (!eventId) return failure(ERROR_CODES.VALIDATION, 'eventId is required');
      return handle(reply, async () => ({
        note: await saveEventNote({
          actorId: OWNER,
          calendarId: String(req.body?.calendarId ?? ''),
          eventId,
          body: String(req.body?.body ?? ''),
          noteId: req.body?.noteId,
        }),
      }));
    },
  );

  app.delete<{ Params: { id: string } }>('/v1/calendar/notes/:id', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => ({ deleted: await deleteEventNote(OWNER, req.params.id) }));
  });

  /* ---------------------------------------------------------- diagnose */
  /* "I can see it and you cannot" needs an answer made of facts, not of
   * theories (D-204). This asks Google live and diffs it against the mirror. */

  app.get<{ Querystring: { from?: string; to?: string; includeDisabled?: string } }>('/v1/calendar/diagnose', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const from = new Date(`${String(req.query.from ?? '').slice(0, 10)}T00:00:00.000Z`);
    const to = new Date(`${String(req.query.to ?? '').slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return failure(ERROR_CODES.VALIDATION, 'from and to must be YYYY-MM-DD');
    }
    /* Enabled calendars only by default (D-205) — a calendar the owner
     * switched off must not be read, quoted, or recommended back on. */
    return handle(reply, async () => diagnoseRange(OWNER, from.toISOString(), to.toISOString(), {
      includeDisabled: String(req.query.includeDisabled ?? '') === 'true',
    }));
  });

  app.post<{ Body: { from?: string; to?: string } }>('/v1/calendar/backfill', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const from = new Date(`${String(req.body?.from ?? '').slice(0, 10)}T00:00:00.000Z`);
    const to = new Date(`${String(req.body?.to ?? '').slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return failure(ERROR_CODES.VALIDATION, 'from and to must be YYYY-MM-DD');
    }
    return handle(reply, async () => ({ results: await backfillRange(OWNER, from.toISOString(), to.toISOString()) }));
  });

  /* --------------------------------------------------------------- sync */

  app.post('/v1/calendar/sync', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    return handle(reply, async () => {
      /* Cold calendars get their four windows first so the grid fills fast;
       * warm ones skip straight to the incremental delta, which is a single
       * cheap call. Either way the owner is not waiting on a full walk. */
      const primed = await syncFirstPaint(OWNER);
      if (primed.length > 0) {
        void syncAll(OWNER).catch((err) => deps.ctx.log.error({ err }, 'background series sync failed'));
        return { results: [], primed: primed.reduce((n, r) => n + r.upserted, 0), staged: true };
      }
      return { results: await syncAll(OWNER), primed: 0, staged: false };
    });
  });

  /**
   * Turn a calendar on or off for this system. Separate from Google's own
   * "selected" flag: what the owner ticks in Google is about their calendar UI;
   * this is about what their assistant works with.
   */
  app.post('/v1/calendar/calendars/toggle', async (req, reply) => {
    if (!guard(req)) return deny(reply);
    const body = req.body as { calendarId?: string; enabled?: boolean };
    if (!body?.calendarId || typeof body.enabled !== 'boolean') {
      return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'calendarId and enabled are required'));
    }
    return handle(reply, async () => {
      const res = await setCalendarEnabled(OWNER, body.calendarId!, body.enabled!);
      // Enabling means it has never been synced; pull it now, in the background
      // so a big calendar cannot time the request out.
      if (res.enabled) {
        void syncAll(OWNER).catch((err) => deps.ctx.log.error({ err }, 'calendar sync after enable failed'));
      }
      return res;
    });
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
      /* Blocked is not the same as unapproved (D-195d): a read-only calendar
       * or an unresolved target cannot be fixed by saying yes, so offering an
       * approval there sends the caller round a loop that never terminates. */
      if (verdict.sensitivity === 'blocked') {
        return failure(ERROR_CODES.VALIDATION, verdict.reason);
      }
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
