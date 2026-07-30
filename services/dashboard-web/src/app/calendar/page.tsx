import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { CalendarControls, ConnectButton } from './controls';
import { MonthGrid, WeekGrid, Agenda, DayPanel, CalendarNav } from './views';
import { toJalali, shiftMonth, addDays, todayKey, buildWeek, type CalEvent, type CalView } from './format';
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
  searchParams: Promise<{ connect?: string; view?: string; day?: string; sel?: string }>;
}) {
  const sp = await searchParams;
  const connectMsg = connectMessage(sp.connect ?? '');
  const status = await gateway.calendarStatus();
  const setup = status?.setup;
  const connected = Boolean(status?.connected);

  const view: CalView = sp.view === 'week' ? 'week' : sp.view === 'agenda' ? 'agenda' : 'month';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? '') ? sp.day! : todayKey();
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(sp.sel ?? '') ? sp.sel! : anchor;

  /* Fetch exactly the window the current view needs — the mirror is local, but
   * a month view has no business pulling a year of rows into the page. */
  const window = view === 'week'
    ? { from: buildWeek(anchor)[0].key, to: addDays(buildWeek(anchor)[6].key, 1) }
    : view === 'agenda'
      ? { from: anchor, to: addDays(anchor, 30) }
      : { from: addDays(anchor, -45), to: addDays(anchor, 45) };

  const [agendaRes, tasksRes] = connected
    ? await Promise.all([gateway.calendarAgenda(window.from, window.to), gateway.calendarTasks()])
    : [null, null];

  const events = (agendaRes?.events ?? []) as unknown as CalEvent[];
  const tasks = (tasksRes?.tasks ?? []) as unknown as Task[];

  const j = toJalali(anchor);
  const title = view === 'week'
    ? `هفتهٔ ${toJalali(buildWeek(anchor)[0].key).day} ${toJalali(buildWeek(anchor)[0].key).monthName}`
    : `${j.monthName} ${j.year}`;
  const prev = view === 'month' ? shiftMonth(anchor, -1) : addDays(anchor, view === 'week' ? -7 : -30);
  const next = view === 'month' ? shiftMonth(anchor, 1) : addDays(anchor, view === 'week' ? 7 : 30);

  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < todayKey());

  return (
    <div className="cal" dir="rtl">
      <header className="cal-head">
        <div>
          <h1>تقویم و کارها</h1>
          <p className="cal-sub">
            {connected
              ? <>متصل به <span dir="ltr">{status?.accountEmail || 'Google'}</span> — این صفحه از آینهٔ محلی می‌خواند، پس سریع است و به سهمیهٔ گوگل دست نمی‌زند.</>
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
          <CalendarNav view={view} anchor={anchor} prev={prev} next={next} selected={selected} title={title} />

          <div className="calx-layout">
            <section className="cal-glass calx-main">
              {view === 'month' && <MonthGrid anchor={anchor} events={events} selected={selected} view={view} />}
              {view === 'week' && <WeekGrid anchor={anchor} events={events} selected={selected} view={view} />}
              {view === 'agenda' && <Agenda anchor={anchor} events={events} selected={selected} view={view} />}
            </section>

            <div className="calx-side">
              <DayPanel dayKey={selected} events={events} />

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
                          {t.due && <span className="cal-task-d" dir="ltr">{toJalali(t.due.slice(0, 10)).day} {toJalali(t.due.slice(0, 10)).monthName}</span>}
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
        {' '}<Link href="/jarvis">از جارویس بخواهید</Link>
      </p>
    </div>
  );
}
