import Link from 'next/link';
import { initials, type Completeness } from './present';

/**
 * Chrome for the profile page (D-187): identity header, tab bar, and the
 * technical disclosure. Server components — no client JS is needed for any of
 * it, because tab state lives in the URL.
 */

const STATUS_LABEL: Record<string, string> = {
  active: 'فعال', pending: 'در انتظار تأیید', suspended: 'معلق', archived: 'بایگانی', merged: 'ادغام‌شده',
};

/**
 * One header that answers, in this order: who am I, is anything wrong, how
 * complete am I. The three counters are LINKS into the tab that fixes them —
 * a number the owner cannot act on is decoration.
 */
export function IdentityHeader({
  name, entityId, status, since, completeness, attention, attestations, documents,
}: {
  name: string;
  entityId: string;
  status: string;
  since: string;
  completeness: Completeness;
  attention: number;
  attestations: number;
  documents: number;
}) {
  return (
    /* Deliberate exception to the rtl shell (D-187c, owner's call): the header
     * is a fixed dashboard of positions — avatar, name, then counters — and
     * mirroring it moved those anchors on every visit, which is harder to scan
     * than reading Persian left-aligned. So the BOX is ltr (stable order,
     * left-aligned), while each text node keeps `unicode-bidi: plaintext` so
     * Persian still renders with correct internal word order. Layout ltr,
     * script-correct text: the two are separable, and here they should be. */
    <header className="prof-id" dir="ltr">
      <div className="prof-id-main">
        <div className="prof-avatar" aria-hidden>{initials(name)}</div>

        <div className="prof-id-text">
          <h1 className="prof-name">{name}</h1>
          <p className="prof-id-sub">
            <span className={`badge ${status === 'active' ? 'ok' : ''}`}>{STATUS_LABEL[status] ?? status}</span>
            <span className="prof-dot">·</span>
            <span>عضو شبکه از {since}</span>
          </p>
        </div>

        <div className="prof-id-stats">
          <Link href="/me/profile?tab=documents" className={`prof-stat${attention ? ' warn' : ''}`}>
            <span className="prof-stat-v">{attention}</span>
            <span className="prof-stat-l">نیازمند توجه</span>
          </Link>
          <Link href="/me/profile?tab=documents" className="prof-stat">
            <span className="prof-stat-v">{documents}</span>
            <span className="prof-stat-l">مدرک</span>
          </Link>
          <Link href="/me/profile?tab=attestations" className="prof-stat">
            <span className="prof-stat-v">{attestations}</span>
            <span className="prof-stat-l">تأیید</span>
          </Link>
        </div>
      </div>

      {/* Completeness is a prompt, not a score: it names the next section. */}
      <div className="prof-complete">
        <div className="prof-bar" role="img" aria-label={`تکمیل پروفایل ${completeness.percent}٪`}>
          <span style={{ width: `${completeness.percent}%` }} />
        </div>
        <span className="prof-complete-t">
          {completeness.missing.length === 0
            ? 'بخش‌های پایه کامل است'
            : <>پروفایل {completeness.percent}٪ کامل — <Link href="/me/profile?tab=info">{completeness.missing.length} بخش پایه باقی مانده</Link></>}
        </span>
      </div>
      <span className="prof-eid" dir="ltr" title="شناسهٔ موجودیت شما در شبکه">{entityId}</span>
    </header>
  );
}

export function TabBar({
  tabs, active,
}: {
  tabs: ReadonlyArray<{ id: string; label: string }>;
  active: string;
}) {
  return (
    <nav className="prof-tabs" aria-label="بخش‌های پروفایل">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.id === 'overview' ? '/me/profile' : `/me/profile?tab=${t.id}`}
          className={`prof-tab${t.id === active ? ' on' : ''}`}
          aria-current={t.id === active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Everything the owner does NOT need in order to read their own profile, but
 * an engineer (or a future agent) needs in order to trust or debug it. Kept on
 * the page deliberately — hiding it in another surface is how systems start
 * lying about where data lives.
 */
export function TechnicalDetails({
  entityId, entityType, status, createdAt, sectionCount, publicKey, storage,
}: {
  entityId: string;
  entityType: string;
  status: string;
  createdAt: string;
  sectionCount: number;
  publicKey: { keyId: string; alg: string; publicKeyPem: string } | null;
  storage: { configured: boolean; reason: string; bucket: string; region: string };
}) {
  return (
    <details className="prof-tech">
      <summary>جزئیات فنی</summary>
      <dl className="prof-tech-grid">
        <dt>شناسهٔ موجودیت</dt><dd dir="ltr">{entityId}</dd>
        <dt>نوع موجودیت</dt><dd dir="ltr">{entityType}</dd>
        <dt>وضعیت</dt><dd dir="ltr">{status}</dd>
        <dt>ایجاد</dt><dd dir="ltr">{createdAt}</dd>
        <dt>تعداد بخش‌ها</dt><dd dir="ltr">{sectionCount}</dd>
        <dt>کلید امضا</dt>
        <dd dir="ltr">{publicKey ? `${publicKey.alg} · ${publicKey.keyId}` : '—'}</dd>
        <dt>ذخیره‌سازی فایل</dt>
        <dd dir="ltr">
          {storage.configured ? `S3 · ${storage.bucket} · ${storage.region}` : (storage.reason || 'not configured')}
        </dd>
        <dt>محل داده</dt>
        <dd dir="ltr">MongoDB Atlas · cin_entities / cin_documents / cin_claims / cin_ledger</dd>
      </dl>
      <p className="prof-tech-note">
        این صفحه روی همان موجودیت CIN ساخته شده که در <Link href="/cin">شبکهٔ هوش جمعی</Link> می‌بینید.
        هیچ نسخهٔ موازی از اطلاعات شما نگهداری نمی‌شود.
      </p>
    </details>
  );
}
