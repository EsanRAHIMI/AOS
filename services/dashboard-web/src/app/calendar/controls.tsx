'use client';
/**
 * Client controls for /calendar (D-192b).
 *
 * The connect button asks the GATEWAY for the authorization URL rather than
 * building it in the browser: the client id and the CSRF `state` belong on the
 * server, and the state must be minted where it will later be verified.
 */
import { useState } from 'react';
import { calendarAuthUrlAction, syncCalendarAction, disconnectCalendarAction } from './actions';
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
          setMsg(r.ok ? 'همگام‌سازی شد' : r.error);
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
