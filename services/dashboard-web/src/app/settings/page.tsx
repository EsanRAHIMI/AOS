import { gateway } from '@/lib/gateway';
import { PreferencesForm, type PreferencesView } from './preferences-form';

export const dynamic = 'force-dynamic';

/**
 * /settings — the settings that belong to the owner, not to the deployment.
 *
 * D-202: the owner moved to Dubai and nothing noticed, because the timezone
 * was an environment variable needing a restart, the calendar system was a URL
 * parameter, currency did not exist, and Jarvis could see none of them. They
 * are now one stored record with one editor.
 */
const FALLBACK: PreferencesView = {
  timezone: 'Asia/Dubai', language: 'fa-IR', currency: 'AED',
  calendarSystem: 'gregorian', weekStartsOn: 6, hourCycle: 'h23', numerals: 'latn',
};

export default async function SettingsPage() {
  const res = await gateway.ownerPreferences().catch(() => null);
  const initial = { ...FALLBACK, ...(res?.preferences ?? {}) } as PreferencesView;

  return (
    <div className="prefs-page" dir="rtl">
      <header className="cal-head">
        <div>
          <h1>تنظیمات</h1>
          <p className="cal-sub">
            منطقهٔ زمانی، زبان، واحد پول و تقویم — یک بار تنظیم می‌شود و همهٔ برنامه،
            از جمله جارویس، با همین کار می‌کند.
          </p>
        </div>
      </header>

      <PreferencesForm initial={initial} />
    </div>
  );
}
