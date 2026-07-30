import Link from 'next/link';
import { gateway } from '@/lib/gateway';
import { EmptyState } from '@/components/ui';
import { AddDocument } from './controls';
import { IdentityHeader, TabBar, TechnicalDetails } from './shell';
import { SectionCard, DocumentCard, AttestationRow, HistoryTimeline, AttentionList } from './views';
import {
  SECTION_LABEL, SECTION_PURPOSE, completeness, expiryPhrase, CORE_SECTIONS,
} from './present';

export const dynamic = 'force-dynamic';

/**
 * The owner's living profile (CIN-1b redesigned, D-187).
 *
 * Still built directly on the CIN entity — no parallel profile table, so
 * identity stays versioned per section, attestable and ledger-anchored. What
 * changed is the SURFACE: the old page rendered storage shapes (a table whose
 * "content" column was `key: value · key: value`), which made the owner decode
 * their own identity. Now:
 *
 *  - one identity header answers "who am I in this system, and is anything
 *    wrong right now",
 *  - five tabs (?tab=) each do exactly one job, so the page never dumps
 *    everything at once and stays readable as sections and documents grow,
 *  - every record is rendered as human Persian; entity ids, section versions
 *    and ledger record types live inside a collapsed «جزئیات فنی» — available
 *    for debugging, never leading.
 *
 * Tabs are URL state, not client state: linkable, refresh-safe, server
 * rendered, and cheap (one fetch set, no client store).
 */

type Entity = {
  entityId: string; name: string; displayName: string; status: string;
  entityType?: string;
  sections: Record<string, { data: Record<string, unknown>; visibility: string; version: number; updatedAt: string; attestedBy: string[] }>;
  createdAt: string;
};

const TABS = [
  { id: 'overview', label: 'نمای کلی' },
  { id: 'info', label: 'اطلاعات من' },
  { id: 'documents', label: 'مدارک' },
  { id: 'attestations', label: 'تأییدها' },
  { id: 'history', label: 'سوابق' },
] as const;

export default async function OwnerProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [sp, me, docsRes, ledger] = await Promise.all([
    searchParams,
    gateway.meEntity(),
    gateway.cinDocuments(),
    gateway.cinLedger(200),
  ]);

  const entity = (me?.entity ?? null) as Entity | null;

  if (!entity) {
    return (
      <div className="prof" dir="rtl">
        <EmptyState
          icon="◌"
          title="هنوز هویتی برای شما ساخته نشده"
          hint={me?.hint ?? 'اجرا کنید: node scripts/cin-genesis-seed.mjs — این کار شما، جارویس و خود کرنل را به‌عنوان سه موجودیت اول شبکه ثبت می‌کند.'}
        />
      </div>
    );
  }

  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? 'overview') as (typeof TABS)[number]['id'];

  const sections = Object.entries(entity.sections ?? {});
  const claims = (me?.claims ?? []) as Array<Record<string, unknown>>;
  const documents = (docsRes?.documents ?? []) as Array<Record<string, unknown>>;
  const storage = docsRes?.storage ?? me?.storage ?? { configured: false, reason: '', bucket: '', region: '' };
  const comp = completeness(entity.sections);

  // Live documents first; archived/superseded are history, not daily concerns.
  const liveDocs = documents.filter((d) => d.status !== 'archived');
  const withExpiry = liveDocs
    .map((d) => ({ doc: d, deadline: expiryPhrase(d.expiresAt as string | null, String(d.status)) }))
    .sort((a, b) => a.deadline.urgency - b.deadline.urgency);
  const needsAttention = withExpiry.filter((x) => x.deadline.tone === 'err' || x.deadline.tone === 'warn');

  // My history: only ledger records about me or my papers.
  const myDocIds = new Set(documents.map((d) => String(d.docId)));
  const history = ((ledger?.records ?? []) as Array<Record<string, unknown>>)
    .filter((r) => String(r.refId) === entity.entityId || myDocIds.has(String(r.refId)) || String(r.actorEntityId) === entity.entityId)
    .slice(-60)
    .reverse();

  const activeClaims = claims.filter((c) => !c.revokedAt);

  return (
    /* The page's own language is Persian, so the SHELL is rtl and every label,
     * heading and layout axis follows from that. Individual content nodes then
     * declare their own direction (bidiProps) — an English value inside this
     * container must not inherit rtl, or it renders right-aligned with its
     * punctuation flipped. Chrome rtl + content per-node is the only
     * combination that stays readable in a bilingual system. */
    <div className="prof" dir="rtl">
      <IdentityHeader
        name={entity.displayName || entity.name}
        entityId={entity.entityId}
        status={entity.status}
        since={String(entity.createdAt).slice(0, 10)}
        completeness={comp}
        attention={needsAttention.length}
        attestations={activeClaims.length}
        documents={liveDocs.length}
      />

      <TabBar tabs={TABS} active={tab} />

      {/* ------------------------------------------------------------ overview */}
      {tab === 'overview' && (
        <div className="prof-grid">
          <section className="card prof-panel">
            <h2 className="prof-h">نیازمند توجه شما</h2>
            <AttentionList
              items={needsAttention}
              missingSections={comp.missing}
              storageConfigured={storage.configured}
              storageReason={storage.reason}
            />
          </section>

          <section className="card prof-panel">
            <h2 className="prof-h">آخرین تغییرات</h2>
            {history.length === 0
              ? <EmptyState icon="◌" title="هنوز تغییری ثبت نشده" hint="هر ویرایش پروفایل یا مدرک اینجا ثبت می‌شود." />
              : <HistoryTimeline records={history.slice(0, 6)} compact />}
            {history.length > 6 && (
              <Link href="/me/profile?tab=history" className="prof-more">دیدن همهٔ سوابق ({history.length})</Link>
            )}
          </section>
        </div>
      )}

      {/* ---------------------------------------------------------------- info */}
      {tab === 'info' && (
        <>
          <p className="prof-lead">
            هر بخش جداگانه نسخه‌گذاری می‌شود و سطح دسترسی مستقل خودش را دارد — یعنی می‌توانید
            مهارت‌هایتان را با شبکه به اشتراک بگذارید و اطلاعات مالی را کاملاً خصوصی نگه دارید.
          </p>
          <div className="prof-sections">
            {sections.map(([name, sec]) => (
              <SectionCard key={name} entityId={entity.entityId} name={name} section={sec} />
            ))}
            {comp.missing.map((name) => (
              <SectionCard
                key={name}
                entityId={entity.entityId}
                name={name}
                section={null}
                purpose={SECTION_PURPOSE[name] ?? `بخش «${SECTION_LABEL[name] ?? name}» هنوز پر نشده است.`}
              />
            ))}
          </div>
          {sections.length === 0 && comp.missing.length === CORE_SECTIONS.length && (
            <p className="prof-lead">با «افزودن» روی یکی از کارت‌های بالا شروع کنید — مثلاً هویت یا راه‌های تماس.</p>
          )}
        </>
      )}

      {/* ----------------------------------------------------------- documents */}
      {tab === 'documents' && (
        <>
          <div className="prof-toolbar">
            <p className="prof-lead" style={{ margin: 0 }}>
              مدرک اول یک «رکورد» است و بعد یک «فایل». حتی بدون اسکن، تاریخ انقضا برای شما پایش می‌شود.
            </p>
            <AddDocument ownerEntityId={entity.entityId} />
          </div>

          {!storage.configured && (
            <div className="prof-note">
              ثبت مدرک کامل کار می‌کند؛ پیوست فایل فعلاً غیرفعال است — {storage.reason || 'فضای ذخیره‌سازی S3 تنظیم نشده'}.
            </div>
          )}

          {liveDocs.length === 0 ? (
            <EmptyState icon="◌" title="مدرکی ثبت نشده" hint="پاسپورت، مدرک تحصیلی، قرارداد… با «ثبت مدرک» شروع کنید." />
          ) : (
            <div className="prof-docs">
              {withExpiry.map(({ doc, deadline }) => (
                <DocumentCard key={String(doc.docId)} doc={doc} deadline={deadline} />
              ))}
            </div>
          )}

          {documents.length > liveDocs.length && (
            <details className="prof-arch">
              <summary>مدارک بایگانی‌شده ({documents.length - liveDocs.length})</summary>
              <div className="prof-docs" style={{ marginTop: 10 }}>
                {documents.filter((d) => d.status === 'archived').map((doc) => (
                  <DocumentCard key={String(doc.docId)} doc={doc} deadline={expiryPhrase(doc.expiresAt as string | null, 'archived')} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {/* -------------------------------------------------------- attestations */}
      {tab === 'attestations' && (
        <section className="card prof-panel">
          <p className="prof-lead">
            تأیید یعنی چیزی که یک نهاد دربارهٔ شما امضا کرده و طرف مقابل می‌تواند بدون دیدن اصل مدرک
            راستی‌آزمایی کند — این همان چیزی است که پروفایل را از یک فرم پرشده جدا می‌کند.
          </p>
          {claims.length === 0 ? (
            <EmptyState
              icon="◌"
              title="هنوز تأییدی صادر نشده"
              hint="وقتی نهادی مدرک یا مهارت شما را امضا کند، اینجا ظاهر می‌شود."
            />
          ) : (
            <div className="prof-claims">
              {claims.map((c) => <AttestationRow key={String(c.claimId)} claim={c} />)}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- history */}
      {tab === 'history' && (
        <section className="card prof-panel">
          <p className="prof-lead">
            هر تغییر با زنجیرهٔ هش ثبت شده است؛ دستکاری گذشته بدون شکستن زنجیره ممکن نیست.
          </p>
          {history.length === 0
            ? <EmptyState icon="◌" title="سابقه‌ای ثبت نشده" hint="هر ویرایش پروفایل یا مدرک شما اینجا ثبت می‌شود." />
            : <HistoryTimeline records={history} />}
        </section>
      )}

      <TechnicalDetails
        entityId={entity.entityId}
        entityType={entity.entityType ?? 'person'}
        status={entity.status}
        createdAt={entity.createdAt}
        sectionCount={sections.length}
        publicKey={me?.publicKey ?? null}
        storage={storage}
      />
    </div>
  );
}
