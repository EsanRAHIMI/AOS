import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { CalendarControls, ConnectButton, CalendarPicker, type CalendarRow } from './controls';
import { MonthGrid, WeekGrid, Agenda, DayPanel, CalendarNav } from './views';
import { DayTimeline, type EventNoteView } from './day-timeline';
import { dateParts, shiftMonth, addDays, todayKey, buildWeek, DEFAULT_CAL_SYSTEM, type CalEvent, type CalView, type CalSystem } from './format';
import { bidiProps } from '@/lib/rtl';

export const dynamic = 'force-dynamic';

/**
 * /calendar — Google Calendar and Tasks (D-192b).
 *
 * Reads the LOCAL mirror, not Google. That is the whole point of the sync
 * engine: this page renders instantly, works when Google is rate-limiting or
 * unreachable, and never spends the owner's API quota on a page refresh.
 *
 * When nothing is connected yet it does not show an error — it shows the
 * remaining setup steps, naming the exact environment variables that are
 * missing. An integration that says "failed" when it means "not configured
 * yet" wastes the owner's afternoon.
 */

/**
 * Google reports the outcome of consent by redirecting back with `?connect=`.
 * Ignoring it — as the first version did — leaves the owner staring at an
 * unchanged page after Google has just told them exactly what went wrong.
 */
function connectMessage(code: string): { tone: 'err' | 'ok'; title: string; detail: string } | null {
  if (!code) return null;
  if (code === 'ok') {
    return {
      tone: 'ok',
      title: 'اتصال برقرار شد',
      detail: 'اولین همگام‌سازی در پس‌زمینه در حال اجراست. چند لحظه بعد صفحه را تازه کنید — یا دکمهٔ «همگام‌سازی» را بزنید.',
    };
  }
  if (code === 'exchange_failed') {
    return {
      tone: 'err',
      title: 'تبادل توکن کامل نشد',
      detail: 'اگر بالای صفحه ایمیل حسابتان را می‌بینید، اتصال در واقع برقرار شده و فقط پاسخ دیر رسیده — «همگام‌سازی» را بزنید. در غیر این صورت دوباره وصل شوید.',
    };
  }
  if (code === 'access_denied') {
    return {
      tone: 'err',
      title: 'گوگل اجازه نداد — حساب شما در فهرست Test users نیست',
      detail: 'اپ در حالت Testing است و فقط حساب‌هایی که خودتان به‌عنوان test user اضافه کرده‌اید می‌توانند اجازه بدهند. '
        + 'در کنسول گوگل → Google Auth Platform → Audience → Test users، همان ایمیلی را که با آن وارد می‌شوید اضافه کنید. '
        + 'برای رفع دائمی (و اینکه توکن هر ۷ روز باطل نشود) همان‌جا Publish app را بزنید.',
    };
  }
  if (code === 'bad_state') {
    return { tone: 'err', title: 'درخواست منقضی یا تکراری بود', detail: 'دوباره «اتصال به گوگل» را بزنید — هر درخواست فقط یک‌بار معتبر است.' };
  }
  if (code === 'redirect_uri_mismatch') {
    return { tone: 'err', title: 'آدرس بازگشت با کنسول یکی نیست', detail: 'مقدار GOOGLE_REDIRECT_URI باید حرف‌به‌حرف با Authorised redirect URI در کنسول یکسان باشد.' };
  }
  return { tone: 'err', title: 'اتصال ناموفق بود', detail: code };
}

type Task = { taskId: string; title: string; due: string; status: string; notes: string; createdByAos: boolean };

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ connect?: string; view?: string; day?: string; sel?: string; cal?: string }>;
}) {
  const sp = await searchParams;
  const connectMsg = connectMessage(sp.connect ?? '');
  const status = await gateway.calendarStatus();
  const setup = status?.setup;
  const connected = Boolean(status?.connected);
  const freshness = status?.freshness;

  const view: CalView = sp.view === 'week' ? 'week'
    : sp.view === 'day' ? 'day'
      : sp.view === 'agenda' ? 'agenda' : 'month';
  /* Gregorian unless asked otherwise (D-197): it is what Google, invitations
   * and everyone the owner works with use. */
  const system: CalSystem = sp.cal === 'jalali' ? 'jalali' : DEFAULT_CAL_SYSTEM;
  const rawAnchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? '') ? sp.day! : todayKey();
  const rawSelected = /^\d{4}-\d{2}-\d{2}$/.test(sp.sel ?? '') ? sp.sel! : rawAnchor;

  /* In the day view the anchor and the selection ARE the same day (D-199b).
   *
   * They drifted apart: paging in month view sets `day` to the 1st of the
   * month (that is what `shiftMonth` does), while `sel` keeps the day you had
   * chosen. Switching to the day view then left the URL saying
   * `day=2026-07-01&sel=2026-07-31` — the header, the arrows and the fetch
   * window all followed the anchor, so the owner was paging around 1 July
   * while looking for something on the 31st and concluding it had never been
   * created. A view of one day has exactly one day; there is nothing for a
   * second variable to mean. */
  const anchor = view === 'day' ? rawSelected : rawAnchor;
  const selected = view === 'day' ? rawSelected : rawSelected;

  /* Fetch exactly the window the current view needs — the mirror is local, but
   * a month view has no business pulling a year of rows into the page. */
  const window = view === 'day'
    ? { from: selected, to: addDays(selected, 1) }
    : view === 'week'
      ? { from: buildWeek(anchor, system)[0].key, to: addDays(buildWeek(anchor, system)[6].key, 1) }
      : view === 'agenda'
        ? { from: anchor, to: addDays(anchor, 30) }
        : { from: addDays(anchor, -45), to: addDays(anchor, 45) };

  const [agendaRes, tasksRes] = connected
    ? await Promise.all([gateway.calendarAgenda(window.from, window.to), gateway.calendarTasks()])
    : [null, null];

  const events = (agendaRes?.events ?? []) as unknown as CalEvent[];

  /* Notes only matter where they are shown, and only for events on screen —
   * one query for the day, not one per event. */
  const notes: Record<string, EventNoteView[]> = view === 'day' && connected
    ? ((await gateway.calendarNotes(events.map((e) => e.eventId)).catch(() => null))?.notes ?? {}) as unknown as Record<string, EventNoteView[]>
    : {};
  const tasks = (tasksRes?.tasks ?? []) as unknown as Task[];

  const j = dateParts(anchor, system);
  const weekStart = buildWeek(anchor, system)[0].key;
  const dayParts = dateParts(selected, system);
  const title = view === 'day'
    ? `${dayParts.day} ${dayParts.monthName} ${dayParts.year}`
    : view === 'week'
      ? `هفتهٔ ${dateParts(weekStart, system).day} ${dateParts(weekStart, system).monthName}`
      : `${j.monthName} ${j.year}`;
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const prev = view === 'month' ? shiftMonth(anchor, -1, system) : addDays(anchor, -step);
  const next = view === 'month' ? shiftMonth(anchor, 1, system) : addDays(anchor, step);

  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < todayKey());

  /** calendarId → display name, so an event can say where it came from. */
  const calendarNames = Object.fromEntries(
    ((status?.calendars ?? []) as Array<{ calendarId?: string; summary?: string }>)
      .map((c) => [String(c.calendarId ?? ''), String(c.summary ?? c.calendarId ?? '')]),
  );

  return (
    <div className="cal" dir="rtl">
      <header className="cal-head">
        <div>
          <h1>تقویم و کارها</h1>
          <p className="cal-sub">
            {connected
              ? <>
                  متصل به <span dir="ltr">{status?.accountEmail || 'Google'}</span>
                  {' — '}{freshness?.oldestSuccessfulSyncAt
                    ? `آخرین همگام‌سازی کامل ${new Date(freshness.oldestSuccessfulSyncAt).toLocaleString('fa-IR')}`
                    : 'در انتظار اولین همگام‌سازی'}
                  {freshness?.stale ? ' — به‌روزرسانی در پس‌زمینه شروع می‌شود' : ''}
                </>
              : 'هنوز به گوگل کلندر وصل نشده‌اید.'}
          </p>
        </div>
        <CalendarControls connected={connected} />
      </header>

      {/* ------------------------------------------------ not connected yet */}
      {!connected && (
        <section className="cal-glass cal-setup">
          <h2>برای اتصال، این مراحل باقی مانده</h2>

          <ol className="cal-steps">
            <li className={setup?.oauthConfigured ? 'done' : ''}>
              <strong>اعتبارنامهٔ OAuth</strong>
              {setup?.oauthConfigured
                ? <span className="cal-ok">تنظیم شده</span>
                : <span className="cal-miss" dir="ltr">{setup?.oauthMissing?.join(' · ') || 'GOOGLE_CLIENT_ID …'}</span>}
            </li>
            <li className={setup?.vaultConfigured ? 'done' : ''}>
              <strong>کلید رمزنگاری توکن</strong>
              {setup?.vaultConfigured
                ? <span className="cal-ok">تنظیم شده</span>
                : <span className="cal-miss" {...bidiProps(setup?.vaultReason ?? '')}>{setup?.vaultReason}</span>}
            </li>
            <li>
              <strong>اجازهٔ دسترسی</strong>
              <span className="cal-miss">بعد از دو مورد بالا، دکمهٔ «اتصال به گوگل» فعال می‌شود.</span>
            </li>
          </ol>

          <p className="cal-note">
            دستورالعمل کامل با لینک مستقیم هر صفحهٔ کنسول گوگل در
            {' '}<code dir="ltr">docs/google-calendar-setup.md</code> است.
            {' '}یک نکتهٔ مهم: تا وقتی اپ در حالت <em>Testing</em> باشد، توکن‌ها هر ۷ روز منقضی می‌شوند.
          </p>

          <ConnectButton disabled={!setup?.oauthConfigured || !setup?.vaultConfigured} />
        </section>
      )}

      {connectMsg && (
        <div className={`cal-alert${connectMsg.tone === 'ok' ? ' ok' : ''}`}>
          <strong>{connectMsg.title}</strong>
          <p>{connectMsg.detail}</p>
        </div>
      )}

      {status?.revokedAt && (
        <div className="cal-alert">
          دسترسی باطل شده — دوباره وصل شوید.{' '}
          <span className="m" {...bidiProps(status.lastError)}>{status.lastError}</span>
        </div>
      )}

      {/* -------------------------------------------------------- connected */}
      {connected && (
        <>
          <CalendarNav view={view} anchor={anchor} prev={prev} next={next} selected={selected} title={title} system={system} />

          <div className="calx-layout">
            <section className="cal-glass calx-main">
              {view === 'month' && <MonthGrid anchor={anchor} events={events} selected={selected} view={view} system={system} />}
              {view === 'week' && <WeekGrid anchor={anchor} events={events} selected={selected} view={view} system={system} />}
              {/* A day is a week of one column — same hour rail, same blocks,
                * so there is no second layout to keep in sync. */}
              {/* A day gets its own layout, not a one-column week: the screen
                * is wide, and a day read left-to-right shows its gaps. */}
              {view === 'day' && (
                <DayTimeline dayKey={selected} events={events} calendars={calendarNames} notes={notes} />
              )}
              {view === 'agenda' && <Agenda anchor={anchor} events={events} selected={selected} view={view} system={system} />}
            </section>

            <div className="calx-side">
              <DayPanel dayKey={selected} events={events} calendars={calendarNames} system={system} />

              <section className="cal-glass calx-picker">
                <CalendarPicker calendars={(status?.calendars ?? []) as unknown as CalendarRow[]} />
              </section>

              <section className="cal-glass cal-tasks">
                <h2>کارها و یادآوری‌ها</h2>
                <p className="cal-note">
                  «ریمایندر» در گوگل محصول جداگانه‌ای نیست — به Tasks منتقل شده. اینجا همان‌هاست.
                </p>
                {tasks.length === 0 ? (
                  <p className="calx-empty">کاری ثبت نشده.</p>
                ) : (
                  <ul className="cal-tasklist">
                    {overdue.length > 0 && <li className="cal-overdue-h">{overdue.length} مورد عقب‌افتاده</li>}
                    {tasks.slice(0, 30).map((t) => {
                      const late = Boolean(t.due) && t.due.slice(0, 10) < todayKey();
                      return (
                        <li key={t.taskId} className={late ? 'late' : ''}>
                          <span className="cal-task-t" {...bidiProps(t.title)}>{t.title}</span>
                          {t.due && <span className="cal-task-d" dir="ltr">{dateParts(t.due.slice(0, 10), system).day} {dateParts(t.due.slice(0, 10), system).monthName}</span>}
                          {t.createdByAos && <span className="cal-tag">AOS</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      <p className="cal-foot">
        جارویس به همین داده‌ها دسترسی دارد. در تقویم <strong>AOS</strong> آزادانه می‌نویسد؛
        نوشتن در تقویم شخصی شما، حذف، و دعوت مهمان تأیید شما را می‌خواهد.
        {' '}<Link href="/">از جارویس بخواهید</Link>
      </p>
    </div>
  );
}
