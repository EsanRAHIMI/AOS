import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';
import { SectionEditor, AddDocument, DocumentControls } from './controls';
import { bidiProps } from '@/lib/rtl';

export const dynamic = 'force-dynamic';

/**
 * The owner's living profile (CIN-1b, D-185).
 *
 * Built directly on the CIN entity graph rather than a parallel profile table,
 * so identity here is versioned per section, carries a visibility level, can
 * be attested by verifiable claims, and leaves a tamper-evident trail in the
 * ledger. Documents are records first and files second — a passport that
 * expires in 40 days is useful information even with no scan attached.
 */

const SECTION_FA: Record<string, string> = {
  identity: 'هویت', contact: 'تماس', education: 'تحصیلات', credentials: 'گواهی‌ها',
  employment: 'شغل', skills: 'مهارت‌ها', financial: 'مالی', assets: 'دارایی‌ها',
  legal: 'حقوقی', health_ref: 'سلامت', memberships: 'عضویت‌ها', achievements: 'دستاوردها',
  preferences: 'ترجیحات', goals: 'اهداف', capabilities: 'توانمندی‌ها',
  governance: 'حاکمیت', operations: 'عملیات',
};

const VIS_FA: Record<string, string> = {
  private: 'خصوصی', restricted: 'محدود', network: 'شبکه', public: 'عمومی',
};

const DOC_TYPE_FA: Record<string, string> = {
  identity: 'هویتی', education: 'تحصیلی', employment: 'شغلی', financial: 'مالی',
  legal: 'حقوقی', medical: 'درمانی', contract: 'قرارداد', license: 'مجوز', other: 'سایر',
};

const STATUS_FA: Record<string, string> = {
  active: 'معتبر', expiring: 'نزدیک انقضا', expired: 'منقضی', superseded: 'جایگزین‌شده', archived: 'بایگانی',
};

/** Suggested sections the owner has not filled yet — an honest to-do, not a fake profile. */
const SUGGESTED = ['identity', 'contact', 'education', 'employment', 'skills', 'financial', 'legal', 'goals'];

export default async function OwnerProfilePage() {
  const [me, docsRes, ledger] = await Promise.all([
    gateway.meEntity(),
    gateway.cinDocuments(),
    gateway.cinLedger(200),
  ]);

  const entity = me?.entity as null | {
    entityId: string; name: string; displayName: string; status: string;
    sections: Record<string, { data: Record<string, unknown>; visibility: string; version: number; updatedAt: string; attestedBy: string[] }>;
    createdAt: string;
  };

  if (!entity) {
    return (
      <>
        <PageHeader title="پروفایل من" subtitle="هویت زندهٔ شما در شبکهٔ هوش جمعی" />
        <EmptyState
          icon="·"
          title="هنوز موجودیت هویتی ساخته نشده"
          hint={me?.hint ?? 'اجرا کنید: node scripts/cin-genesis-seed.mjs — این کار شما، جارویس و خود کرنل را به‌عنوان سه موجودیت اول شبکه ثبت می‌کند.'}
        />
      </>
    );
  }

  const sections = Object.entries(entity.sections ?? {});
  const claims = (me?.claims ?? []) as Array<Record<string, unknown>>;
  const documents = (docsRes?.documents ?? []) as Array<Record<string, unknown>>;
  const storage = docsRes?.storage ?? me?.storage ?? { configured: false, reason: '', bucket: '', region: '' };
  const summary = me?.documents ?? null;
  const missing = SUGGESTED.filter((s) => !entity.sections?.[s]);

  // My history: only ledger records that are about me or my papers.
  const myDocIds = new Set(documents.map((d) => String(d.docId)));
  const history = ((ledger?.records ?? []) as Array<Record<string, unknown>>)
    .filter((r) => String(r.refId) === entity.entityId || myDocIds.has(String(r.refId)) || String(r.actorEntityId) === entity.entityId)
    .slice(-40)
    .reverse();

  return (
    <>
      <PageHeader
        title={entity.displayName || entity.name}
        subtitle={`هویت زندهٔ شما — ${entity.entityId} · ثبت‌شده ${String(entity.createdAt).slice(0, 10)}`}
        actions={<Link href={`/cin/entities/${entity.entityId}`} className="btn btn-ghost">نمای شبکه</Link>}
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <MetricCard label="بخش‌های پروفایل" value={sections.length} hint={missing.length ? `${missing.length} بخش پیشنهادی خالی` : 'پایه کامل است'} tone={sections.length ? 'ok' : undefined} />
        <MetricCard label="ادعاهای دربارهٔ من" value={claims.length} hint={claims.length ? 'قابل راستی‌آزمایی با امضا' : 'هنوز ادعایی صادر نشده'} />
        <MetricCard label="مدارک" value={summary?.total ?? documents.length} hint={`${summary?.withFile ?? documents.filter((d) => d.file).length} فایل ذخیره‌شده`} />
        <MetricCard
          label="نیازمند توجه"
          value={(summary?.expiring.length ?? 0) + (summary?.expired.length ?? 0)}
          tone={(summary?.expired.length ?? 0) > 0 ? 'warn' : (summary?.expiring.length ?? 0) > 0 ? 'warn' : 'ok'}
          hint={(summary?.expired.length ?? 0) > 0 ? 'مدرک منقضی دارید' : (summary?.expiring.length ?? 0) > 0 ? 'نزدیک انقضا' : 'همه معتبر'}
        />
      </div>

      {/* ------------------------------ sections ------------------------------ */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          بخش‌های زندهٔ پروفایل — هر بخش نسخه‌دار است و سطح دسترسی خودش را دارد
        </div>
        {sections.length === 0 ? (
          <EmptyState icon="·" title="پروفایل خالی است" hint="با «ویرایش» یک بخش بسازید — مثلاً هویت یا تماس." />
        ) : (
          <table>
            <thead><tr><th>بخش</th><th>محتوا</th><th>دسترسی</th><th>نسخه</th><th>به‌روزرسانی</th><th /></tr></thead>
            <tbody>
              {sections.map(([name, sec]) => (
                <tr key={name}>
                  <td><span className="badge">{SECTION_FA[name] ?? name}</span></td>
                  <td className="m" {...bidiProps(JSON.stringify(sec.data))}>
                    {Object.entries(sec.data).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}
                  </td>
                  <td className="m">{VIS_FA[sec.visibility] ?? sec.visibility}</td>
                  <td className="m" dir="ltr">v{sec.version}</td>
                  <td className="m" dir="ltr">{String(sec.updatedAt).slice(0, 10)}</td>
                  <td><SectionEditor entityId={entity.entityId} section={name} initial={sec.data} visibility={sec.visibility} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {missing.length > 0 && (
          <p className="m" style={{ marginTop: 10, fontSize: 11.5 }} dir="rtl">
            بخش‌های پیشنهادی که هنوز پر نشده‌اند: {missing.map((s) => SECTION_FA[s] ?? s).join('، ')}
            {' '}— هرکدام را با ویرایش یک بخش موجود یا از طریق جارویس اضافه کنید.
          </p>
        )}
      </div>

      {/* ------------------------------ documents ----------------------------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>مدارک و اسناد</span>
          <span style={{ marginInlineStart: 'auto' }}><AddDocument ownerEntityId={entity.entityId} /></span>
        </div>
        {!storage.configured && (
          <p className="m" style={{ fontSize: 11.5, marginBottom: 8 }} dir="rtl">
            ثبت مدرک کامل کار می‌کند؛ اما پیوست فایل فعلاً غیرفعال است — {storage.reason || 'فضای ذخیره‌سازی S3 تنظیم نشده'}.
          </p>
        )}
        {documents.length === 0 ? (
          <EmptyState icon="·" title="مدرکی ثبت نشده" hint="پاسپورت، مدرک تحصیلی، قرارداد… حتی بدون فایل، تاریخ انقضا برایتان پایش می‌شود." />
        ) : (
          <table>
            <thead><tr><th>عنوان</th><th>نوع</th><th>صادرکننده</th><th>انقضا</th><th>وضعیت</th><th>فایل</th><th /></tr></thead>
            <tbody>
              {documents.map((d) => (
                <tr key={String(d.docId)}>
                  <td {...bidiProps(String(d.title))}>{String(d.title)}</td>
                  <td className="m">{DOC_TYPE_FA[String(d.docType)] ?? String(d.docType)}</td>
                  <td className="m" {...bidiProps(String(d.issuer ?? ''))}>{String(d.issuer || '—')}</td>
                  <td className="m" dir="ltr">{d.expiresAt ? String(d.expiresAt).slice(0, 10) : '—'}</td>
                  <td>
                    <span className={`badge${d.status === 'expired' ? ' err' : d.status === 'expiring' ? ' warn' : ''}`}>
                      {STATUS_FA[String(d.status)] ?? String(d.status)}
                    </span>
                  </td>
                  <td className="m">{d.file ? 'دارد' : '—'}</td>
                  <td><DocumentControls docId={String(d.docId)} hasFile={Boolean(d.file)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* -------------------------------- claims ------------------------------ */}
      <div className="grid cols-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>ادعاهای امضاشده دربارهٔ من</div>
          {claims.length === 0 ? (
            <EmptyState icon="·" title="هنوز ادعایی نیست" hint="ادعا یعنی چیزی که یک نهاد دربارهٔ شما امضا کرده و طرف مقابل می‌تواند بدون دیدن مدرک راستی‌آزمایی کند." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              {claims.slice(0, 12).map((c) => (
                <div key={String(c.claimId)} className="m" dir="rtl">
                  <span className="badge" dir="ltr">{String(c.claimType)}</span>{' '}
                  از <span dir="ltr">{String(c.issuerEntityId)}</span>
                  {c.revokedAt ? ' — باطل‌شده' : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>سوابق — تاریخچهٔ دستکاری‌ناپذیر</div>
          {history.length === 0 ? (
            <EmptyState icon="·" title="سابقه‌ای ثبت نشده" hint="هر تغییر در پروفایل یا مدارک شما اینجا با زنجیرهٔ هش ثبت می‌شود." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, maxHeight: 260, overflow: 'auto' }}>
              {history.map((r) => (
                <div key={String(r.ledgerId)} className="m" dir="rtl">
                  <span dir="ltr">[{String(r.at).slice(0, 16).replace('T', ' ')}]</span>{' '}
                  <span className="badge" dir="ltr">{String(r.recordType)}</span>{' '}
                  <span {...bidiProps(String(r.summary))}>{String(r.summary)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="m" style={{ fontSize: 12 }} dir="rtl">
        این صفحه روی موجودیت CIN شما ساخته شده — همان هویتی که در{' '}
        <Link href="/cin">شبکهٔ هوش جمعی</Link> می‌بینید. هیچ کپی موازی از اطلاعات شما وجود ندارد.
      </p>
    </>
  );
}
