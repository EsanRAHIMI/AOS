'use client';
/**
 * Locale, money and time — the settings that change when you cross a border.
 *
 * One form, saved to one record, read by everything: the calendar grid, the
 * alert sentences, and the RIGHT NOW block Jarvis reasons from. Before this,
 * the timezone was an environment variable that needed a restart, the calendar
 * system was a URL parameter, and currency did not exist.
 *
 * The live preview is the point. A timezone is impossible to verify by reading
 * its name — "Asia/Dubai" tells you nothing — but "الان: 14:32" tells you
 * immediately whether it is right.
 */
import { useEffect, useState } from 'react';
import { savePreferencesAction } from './actions';
import { bidiProps } from '@/lib/rtl';

export interface PreferencesView {
  timezone: string;
  language: string;
  currency: string;
  calendarSystem: 'gregorian' | 'jalali' | 'islamic';
  weekStartsOn: number;
  hourCycle: 'h23' | 'h12';
  numerals: 'latn' | 'arabext';
}

/* Shortlists, not the full IANA database: these are the places and currencies
 * this owner actually moves between. "Other" is the free-text field below. */
const ZONES = [
  ['Asia/Dubai', 'دبی — امارات (UTC+4)'],
  ['Asia/Tehran', 'تهران — ایران (UTC+3:30)'],
  ['Europe/London', 'لندن (UTC+0/+1)'],
  ['Europe/Berlin', 'برلین (UTC+1/+2)'],
  ['Asia/Istanbul', 'استانبول (UTC+3)'],
  ['America/New_York', 'نیویورک (UTC-5/-4)'],
];
const CURRENCIES = [['AED', 'درهم امارات'], ['IRR', 'ریال ایران'], ['USD', 'دلار'], ['EUR', 'یورو'], ['GBP', 'پوند']];
const LANGUAGES = [['fa-IR', 'فارسی'], ['en-AE', 'English (UAE)'], ['en-GB', 'English (UK)'], ['ar-AE', 'العربية']];
const WEEKDAYS = [['6', 'شنبه'], ['0', 'یک‌شنبه'], ['1', 'دوشنبه']];

export function PreferencesForm({ initial }: { initial: PreferencesView }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  /* Preview after mount only: it reads the clock, and a clock rendered on the
   * server never matches the one in the browser (see D-198c). */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const set = <K extends keyof PreferencesView>(k: K, v: PreferencesView[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setMsg(''); setErr('');
  };

  const preview = (() => {
    if (!now) return null;
    const cal = form.calendarSystem === 'jalali' ? 'persian' : form.calendarSystem === 'islamic' ? 'islamic' : 'gregory';
    const locale = `${form.language}-u-ca-${cal}-nu-${form.numerals}-hc-${form.hourCycle}`;
    try {
      return {
        time: new Intl.DateTimeFormat(locale, { timeZone: form.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now),
        date: new Intl.DateTimeFormat(locale, { timeZone: form.timezone, dateStyle: 'full' }).format(now),
        money: new Intl.NumberFormat(locale, { style: 'currency', currency: form.currency }).format(1234.5),
      };
    } catch {
      // An invalid combination must show as "cannot render", not crash the page.
      return null;
    }
  })();

  const save = async () => {
    setBusy(true); setMsg(''); setErr('');
    const res = await savePreferencesAction({ ...form, weekStartsOn: Number(form.weekStartsOn) });
    setBusy(false);
    if (res.ok) setMsg('ذخیره شد — همهٔ صفحه‌ها و جارویس از همین لحظه با این تنظیمات کار می‌کنند.');
    else setErr(res.error);
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  return (
    <div className="prefs" dir="rtl">
      <section className="cal-glass prefs-card">
        <h2>منطقه و زبان</h2>
        <p className="cal-note">
          این تنظیمات یک جا ذخیره می‌شوند و همه‌جا خوانده می‌شوند — تقویم، یادآوری‌ها،
          و همان بلوکی که جارویس تاریخ و ساعت را از آن می‌خواند.
        </p>

        <div className="prefs-grid">
          <label>
            <span>منطقهٔ زمانی</span>
            <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {!ZONES.some(([v]) => v === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
            </select>
            <em>نام IANA — مثل <span dir="ltr">Asia/Dubai</span>. نه نام شهر، نه اختلاف ساعت.</em>
          </label>

          <label>
            <span>منطقهٔ دیگر (دستی)</span>
            <input dir="ltr" value={form.timezone} onChange={(e) => set('timezone', e.target.value.trim())}
              placeholder="Asia/Dubai" />
            <em>اگر شهرتان در فهرست نیست.</em>
          </label>

          <label>
            <span>زبان</span>
            <select value={form.language} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label>
            <span>واحد پول</span>
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l} ({v})</option>)}
            </select>
          </label>

          <label>
            <span>تقویم</span>
            <select value={form.calendarSystem} onChange={(e) => set('calendarSystem', e.target.value as PreferencesView['calendarSystem'])}>
              <option value="gregorian">میلادی</option>
              <option value="jalali">شمسی</option>
              <option value="islamic">قمری</option>
            </select>
          </label>

          <label>
            <span>هفته شروع می‌شود از</span>
            <select value={String(form.weekStartsOn)} onChange={(e) => set('weekStartsOn', Number(e.target.value))}>
              {WEEKDAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label>
            <span>ساعت</span>
            <select value={form.hourCycle} onChange={(e) => set('hourCycle', e.target.value as PreferencesView['hourCycle'])}>
              <option value="h23">۲۴ ساعته</option>
              <option value="h12">۱۲ ساعته (AM/PM)</option>
            </select>
          </label>

          <label>
            <span>ارقام</span>
            <select value={form.numerals} onChange={(e) => set('numerals', e.target.value as PreferencesView['numerals'])}>
              <option value="latn">لاتین (۱۲۳ → 123)</option>
              <option value="arabext">فارسی (۱۲۳)</option>
            </select>
          </label>
        </div>
      </section>

      {/* A timezone cannot be verified by reading its name. It can be verified
        * by looking at the clock. */}
      <section className="cal-glass prefs-card">
        <h2>پیش‌نمایش زنده</h2>
        {preview ? (
          <dl className="prefs-preview">
            <div><dt>الان</dt><dd dir="ltr">{preview.time}</dd></div>
            <div><dt>امروز</dt><dd {...bidiProps(preview.date)}>{preview.date}</dd></div>
            <div><dt>مبلغ نمونه</dt><dd dir="ltr">{preview.money}</dd></div>
          </dl>
        ) : (
          <p className="cal-err">
            {now ? 'این ترکیب قابل نمایش نیست — منطقهٔ زمانی یا زبان را بررسی کنید.' : '…'}
          </p>
        )}
      </section>

      <div className="prefs-actions">
        <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
        {dirty && !busy && <span className="cal-note">تغییرات ذخیره نشده</span>}
        {msg && <span className="cal-msg">{msg}</span>}
        {err && <span className="cal-err" {...bidiProps(err)}>{err}</span>}
      </div>
    </div>
  );
}
