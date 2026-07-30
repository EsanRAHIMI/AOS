'use client';
/**
 * Client controls for /calendar (D-192b).
 *
 * The connect button asks the GATEWAY for the authorization URL rather than
 * building it in the browser: the client id and the CSRF `state` belong on the
 * server, and the state must be minted where it will later be verified.
 */
import { useState } from 'react';
import { calendarAuthUrlAction, syncCalendarAction, disconnectCalendarAction, toggleCalendarAction } from './actions';
import { bidiProps } from '@/lib/rtl';

export function ConnectButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const connect = async () => {
    setBusy(true);
    setErr('');
    const res = await calendarAuthUrlAction();
    setBusy(false);
    if ('url' in res) window.location.href = res.url;
    else setErr(res.error);
  };

  return (
    <>
      <button type="button" className="btn cal-connect" disabled={disabled || busy} onClick={() => void connect()}>
        {busy ? 'در حال آماده‌سازی…' : 'اتصال به گوگل'}
      </button>
      {err && <p className="cal-err" {...bidiProps(err)}>{err}</p>}
    </>
  );
}

export function CalendarControls({ connected }: { connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!connected) return null;

  return (
    <div className="cal-actions">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setMsg('');
          const r = await syncCalendarAction();
          setBusy(false);
          if (!r.ok) { setMsg(r.error); return; }
          if (r.staged) {
            setMsg('ماه‌های جاری آمد — بقیه در پس‌زمینه');
            // The background walk is still filling older months. Refresh once
            // it has had time to land, rather than leaving a half-full grid
            // that looks like the sync failed.
            setTimeout(() => window.location.reload(), 12_000);
          } else {
            setMsg('همگام‌سازی شد');
          }
        }}
      >{busy ? 'در حال همگام‌سازی…' : 'همگام‌سازی'}</button>

      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          // Disconnecting removes OUR stored grant. It does not revoke the app
          // in the Google account, so say so rather than implying it did.
          if (!confirm('اتصال قطع شود؟ توکن ذخیره‌شده حذف می‌شود (دسترسی در حساب گوگل جداگانه لغو می‌شود).')) return;
          setBusy(true);
          await disconnectCalendarAction();
          setBusy(false);
          window.location.reload();
        }}
      >قطع اتصال</button>

      {msg && <span className="cal-msg" {...bidiProps(msg)}>{msg}</span>}
    </div>
  );
}

export interface CalendarRow {
  calendarId: string;
  summary: string;
  accessRole: string;
  primary: boolean;
  enabled: boolean;
  isAosCalendar: boolean;
  backgroundColor: string;
}

const ROLE_FA: Record<string, string> = {
  owner: 'مال شما',
  writer: 'اجازهٔ نوشتن',
  reader: 'فقط خواندن',
  freeBusyReader: 'فقط مشغول/آزاد',
  writerWithoutPrivateAccess: 'نوشتن (بدون رویداد خصوصی)',
};

/**
 * The calendar switchboard (D-193e).
 *
 * Google's `calendarList` returns every calendar the account can reach —
 * including ones other people shared. Syncing all of them unasked is how this
 * system ended up showing someone else's schedule, and syncing only the ones
 * Google has ticked hides calendars the owner actually wants. So the choice is
 * explicit and theirs, defaulting to the calendars they own.
 */
export function CalendarPicker({ calendars }: { calendars: CalendarRow[] }) {
  const [busy, setBusy] = useState('');
  const [rows, setRows] = useState(calendars);

  const toggle = async (row: CalendarRow) => {
    setBusy(row.calendarId);
    const next = !row.enabled;
    // Optimistic: the switch must feel like a switch, not a form submission.
    setRows((r) => r.map((c) => (c.calendarId === row.calendarId ? { ...c, enabled: next } : c)));
    const res = await toggleCalendarAction(row.calendarId, next);
    setBusy('');
    if (!res.ok) setRows((r) => r.map((c) => (c.calendarId === row.calendarId ? { ...c, enabled: row.enabled } : c)));
  };

  if (rows.length === 0) {
    return <p className="calx-empty">هنوز تقویمی خوانده نشده — «همگام‌سازی» را بزنید.</p>;
  }

  const mine = rows.filter((c) => c.accessRole === 'owner' || c.isAosCalendar);
  const shared = rows.filter((c) => !(c.accessRole === 'owner' || c.isAosCalendar));

  const list = (items: CalendarRow[]) => (
    <ul className="calpick">
      {items.map((c) => (
        <li key={c.calendarId} className={c.enabled ? 'on' : ''}>
          <button
            type="button"
            className="calpick-row"
            disabled={busy === c.calendarId}
            onClick={() => void toggle(c)}
            aria-pressed={c.enabled}
          >
            <span className={`calpick-box${c.enabled ? ' on' : ''}`} aria-hidden>{c.enabled ? '✓' : ''}</span>
            <span className="calpick-dot" style={{ background: c.backgroundColor || 'var(--muted)' }} aria-hidden />
            <span className="calpick-name" {...bidiProps(c.summary)}>
              {c.summary || c.calendarId}
              {c.primary && <em> · اصلی</em>}
              {c.isAosCalendar && <em> · AOS</em>}
            </span>
            <span className="calpick-role">{ROLE_FA[c.accessRole] ?? c.accessRole}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="calpick-wrap">
      <h3>تقویم‌های من</h3>
      {mine.length ? list(mine) : <p className="calx-empty">تقویمی که مال خودتان باشد پیدا نشد.</p>}

      {shared.length > 0 && (
        <>
          <h3>به اشتراک گذاشته‌شده با من</h3>
          <p className="cal-note">
            این‌ها مال حساب‌های دیگرند و پیش‌فرض خاموش‌اند. با روشن‌کردن، محتوایشان وارد این سیستم می‌شود.
          </p>
          {list(shared)}
        </>
      )}
    </div>
  );
}
