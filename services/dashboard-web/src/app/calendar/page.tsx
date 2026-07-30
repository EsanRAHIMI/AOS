import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { CalendarControls, ConnectButton } from './controls';
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

type Ev = {
  eventId: string; calendarId: string; summary: string; start: string; end: string;
  allDay: boolean; location: string; status: string; hangoutLink: string; htmlLink: string;
  createdByAos: boolean; attendees: Array<{ email: string }>;
};
type Task = { taskId: string; title: string; due: string; status: string; notes: string; createdByAos: boolean };

const DAY_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

function dayKey(iso: string): string { return iso.slice(0, 10); }

function humanDay(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (key === today) return 'امروز';
  if (key === tomorrow) return 'فردا';
  const d = new Date(`${key}T12:00:00Z`);
  return `${DAY_FA[d.getUTCDay()]} ${key}`;
}

function clock(iso: string, allDay: boolean): string {
  if (allDay) return 'تمام‌روز';
  const t = iso.slice(11, 16);
  return t || '—';
}

export default async function CalendarPage() {
  const status = await gateway.calendarStatus();
  const setup = status?.setup;
  const connected = Boolean(status?.connected);

  const [agendaRes, tasksRes] = connected
    ? await Promise.all([gateway.calendarAgenda(), gateway.calendarTasks()])
    : [null, null];

  const events = (agendaRes?.events ?? []) as unknown as Ev[];
  const tasks = (tasksRes?.tasks ?? []) as unknown as Task[];

  const byDay = new Map<string, Ev[]>();
  for (const e of events) {
    const k = dayKey(e.start);
    if (!k) continue;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 21);

  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < new Date().toISOString().slice(0, 10));

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

      {status?.revokedAt && (
        <div className="cal-alert">
          دسترسی باطل شده — دوباره وصل شوید.{' '}
          <span className="m" {...bidiProps(status.lastError)}>{status.lastError}</span>
        </div>
      )}

      {/* -------------------------------------------------------- connected */}
      {connected && (
        <div className="cal-grid">
          <section className="cal-glass cal-agenda">
            <h2>برنامهٔ پیش‌رو</h2>
            {days.length === 0 ? (
              <p className="cal-empty">رویدادی در ۳۰ روز آینده ثبت نشده — یا هنوز همگام‌سازی نشده است.</p>
            ) : days.map(([key, list]) => (
              <div className="cal-day" key={key}>
                <h3 className="cal-day-h">{humanDay(key)}</h3>
                <ul className="cal-events">
                  {list.sort((a, b) => a.start.localeCompare(b.start)).map((e) => (
                    <li key={`${e.calendarId}:${e.eventId}`} className={e.createdByAos ? 'aos' : ''}>
                      <span className="cal-time" dir="ltr">{clock(e.start, e.allDay)}</span>
                      <span className="cal-body">
                        <span className="cal-title" {...bidiProps(e.summary)}>{e.summary || '(بدون عنوان)'}</span>
                        {(e.location || e.attendees?.length > 0) && (
                          <span className="cal-meta" {...bidiProps(e.location)}>
                            {e.location}
                            {e.attendees?.length > 0 && `${e.location ? ' · ' : ''}${e.attendees.length} مهمان`}
                          </span>
                        )}
                      </span>
                      {e.createdByAos && <span className="cal-tag">AOS</span>}
                      {e.hangoutLink && (
                        <a className="cal-meet" href={e.hangoutLink} target="_blank" rel="noopener noreferrer">Meet</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="cal-glass cal-tasks">
            <h2>کارها و یادآوری‌ها</h2>
            <p className="cal-note">
              «ریمایندر» در گوگل دیگر محصول جداگانه‌ای نیست — به Tasks منتقل شده. اینجا همان‌هاست.
            </p>
            {tasks.length === 0 ? (
              <p className="cal-empty">کاری ثبت نشده.</p>
            ) : (
              <ul className="cal-tasklist">
                {overdue.length > 0 && <li className="cal-overdue-h">{overdue.length} مورد عقب‌افتاده</li>}
                {tasks.slice(0, 40).map((t) => {
                  const late = t.due && t.due.slice(0, 10) < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={t.taskId} className={late ? 'late' : ''}>
                      <span className="cal-task-t" {...bidiProps(t.title)}>{t.title}</span>
                      {t.due && <span className="cal-task-d" dir="ltr">{t.due.slice(0, 10)}</span>}
                      {t.createdByAos && <span className="cal-tag">AOS</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      <p className="cal-foot">
        جارویس به همین داده‌ها دسترسی دارد. در تقویم <strong>AOS</strong> آزادانه می‌نویسد؛
        نوشتن در تقویم شخصی شما، حذف، و دعوت مهمان تأیید شما را می‌خواهد.
        {' '}<Link href="/jarvis">از جارویس بخواهید</Link>
      </p>
    </div>
  );
}
