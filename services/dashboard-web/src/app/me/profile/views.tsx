import Link from 'next/link';
import { SectionEditor, DocumentControls } from './controls';
import { bidiProps } from '@/lib/rtl';
import {
  SECTION_LABEL, SECTION_PURPOSE, VISIBILITY_LABEL, VISIBILITY_HINT, DOC_TYPE_LABEL,
  fieldLabel, formatValue, valueKind, recordSentence, recordGroup, whenPhrase,
  claimSentence, type Deadline,
} from './present';

/**
 * The five profile views (D-187). Server components; only the editors inside
 * them are client components, so the page ships almost no JS.
 *
 * The rule everywhere below: render the MEANING first (a labelled field, a
 * sentence, a deadline in days) and keep the machine form (ids, versions,
 * record types) as a secondary detail — never as the primary text.
 */

/* ----------------------------------------------------------- section cards */

/** One field of a profile section, rendered according to what it actually is. */
function Field({ name, value }: { name: string; value: unknown }) {
  const kind = valueKind(value);
  const text = formatValue(value);
  // The LABEL's language is data-dependent too: a curated key gives Persian,
  // an unknown key falls back to a humanised English string.
  const label = fieldLabel(name);
  return (
    <div className="prof-field">
      <dt {...bidiProps(label)}>{label}</dt>
      <dd>
        {kind === 'email' ? <a href={`mailto:${text}`} dir="ltr">{text}</a>
          : kind === 'url' ? <a href={text} target="_blank" rel="noopener noreferrer" dir="ltr">{text}</a>
            : kind === 'phone' ? <a href={`tel:${text.replace(/\s/g, '')}`} dir="ltr">{text}</a>
              : <span {...bidiProps(text)}>{text}</span>}
      </dd>
    </div>
  );
}

export function SectionCard({
  entityId, name, section, purpose,
}: {
  entityId: string;
  name: string;
  section: { data: Record<string, unknown>; visibility: string; version: number; updatedAt: string; attestedBy: string[] } | null;
  purpose?: string;
}) {
  // Known sections have Persian names; an unmapped one keeps its raw id.
  const label = SECTION_LABEL[name] ?? name;
  const fields = section ? Object.entries(section.data) : [];

  // An empty section is an invitation with a reason, not a blank card.
  if (!section) {
    return (
      <article className="card prof-sec empty">
        <header className="prof-sec-head">
          <h3 {...bidiProps(label)}>{label}</h3>
        </header>
        <p className="prof-sec-purpose">{purpose ?? SECTION_PURPOSE[name] ?? ''}</p>
        <footer className="prof-sec-foot">
          <SectionEditor entityId={entityId} section={name} initial={{}} visibility="private" label={`افزودن ${label}`} />
        </footer>
      </article>
    );
  }

  return (
    <article className="card prof-sec">
      <header className="prof-sec-head">
        <h3 {...bidiProps(label)}>{label}</h3>
        <span className="prof-vis" title={VISIBILITY_HINT[section.visibility] ?? ''}>
          {VISIBILITY_LABEL[section.visibility] ?? section.visibility}
        </span>
      </header>

      {fields.length === 0 ? (
        <p className="prof-sec-purpose">این بخش ساخته شده اما هنوز فیلدی ندارد.</p>
      ) : (
        <dl className="prof-fields">
          {fields.map(([k, v]) => <Field key={k} name={k} value={v} />)}
        </dl>
      )}

      <footer className="prof-sec-foot">
        <SectionEditor entityId={entityId} section={name} initial={section.data} visibility={section.visibility} />
        <span className="prof-sec-meta" dir="ltr" title={`نسخهٔ ${section.version} · آخرین تغییر ${section.updatedAt}`}>
          v{section.version} · {String(section.updatedAt).slice(0, 10)}
        </span>
        {section.attestedBy?.length > 0 && <span className="badge ok">تأییدشده</span>}
      </footer>
    </article>
  );
}

/* --------------------------------------------------------------- documents */

export function DocumentCard({ doc, deadline }: { doc: Record<string, unknown>; deadline: Deadline }) {
  const title = String(doc.title ?? '');
  const issuer = String(doc.issuer ?? '');
  const hasFile = Boolean(doc.file);

  return (
    <article className={`card prof-doc${deadline.tone ? ` ${deadline.tone}` : ''}`}>
      <div className="prof-doc-top">
        <h3 {...bidiProps(title)}>{title}</h3>
        <span className="badge" {...bidiProps(DOC_TYPE_LABEL[String(doc.docType)] ?? String(doc.docType))}>
          {DOC_TYPE_LABEL[String(doc.docType)] ?? String(doc.docType)}
        </span>
      </div>

      <p className={`prof-doc-deadline ${deadline.tone}`}>{deadline.text}</p>

      <dl className="prof-doc-meta">
        {issuer && <><dt>صادرکننده</dt><dd {...bidiProps(issuer)}>{issuer}</dd></>}
        {doc.reference ? <><dt>شماره</dt><dd dir="ltr">{String(doc.reference)}</dd></> : null}
        {doc.issuedAt ? <><dt>تاریخ صدور</dt><dd dir="ltr">{String(doc.issuedAt).slice(0, 10)}</dd></> : null}
        <dt>فایل</dt>
        <dd>{hasFile ? 'پیوست دارد' : 'بدون فایل — رکورد پایش می‌شود'}</dd>
      </dl>

      <footer className="prof-doc-foot">
        <DocumentControls docId={String(doc.docId)} hasFile={hasFile} />
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------ attestations */

export function AttestationRow({ claim }: { claim: Record<string, unknown> }) {
  const revoked = Boolean(claim.revokedAt);
  return (
    <div className={`prof-claim${revoked ? ' revoked' : ''}`}>
      <span className={`prof-claim-mark ${revoked ? 'err' : 'ok'}`} aria-hidden>{revoked ? '×' : '✓'}</span>
      <div className="prof-claim-body">
        <p className="prof-claim-t" {...bidiProps(claimSentence(String(claim.claimType)))}>
          {claimSentence(String(claim.claimType))}
        </p>
        <p className="prof-claim-m">
          صادرکننده: <span dir="ltr">{String(claim.issuerEntityId ?? '—')}</span>
          {claim.issuedAt ? <> · {whenPhrase(String(claim.issuedAt))}</> : null}
          {revoked ? ' · باطل شده' : ''}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */

export function HistoryTimeline({
  records, compact = false,
}: {
  records: Array<Record<string, unknown>>;
  compact?: boolean;
}) {
  return (
    <ol className={`prof-timeline${compact ? ' compact' : ''}`}>
      {records.map((r) => {
        const type = String(r.recordType ?? '');
        const summary = String(r.summary ?? '');
        return (
          <li key={String(r.ledgerId)} className={`prof-tl-${recordGroup(type)}`}>
            <div className="prof-tl-line">
              <span className="prof-tl-when" {...bidiProps(whenPhrase(String(r.at)))}>{whenPhrase(String(r.at))}</span>
              <span className="prof-tl-what" {...bidiProps(recordSentence(type))}>{recordSentence(type)}</span>
            </div>
            {!compact && summary && (
              <p className="prof-tl-detail" {...bidiProps(summary)}>{summary}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- overview */

/**
 * The overview's only job: everything that is actually wrong or missing, in
 * one list, each row linking to where it gets fixed. When there is nothing,
 * it says so plainly rather than manufacturing activity.
 */
export function AttentionList({
  items, missingSections, storageConfigured, storageReason,
}: {
  items: Array<{ doc: Record<string, unknown>; deadline: Deadline }>;
  missingSections: string[];
  storageConfigured: boolean;
  storageReason: string;
}) {
  const nothing = items.length === 0 && missingSections.length === 0 && storageConfigured;

  if (nothing) {
    return (
      <div className="prof-clear">
        <span className="prof-clear-mark" aria-hidden>✓</span>
        <p>همه‌چیز مرتب است — مدرک منقضی یا نزدیک‌انقضا ندارید و بخش‌های پایه کامل‌اند.</p>
      </div>
    );
  }

  return (
    <ul className="prof-attn">
      {items.map(({ doc, deadline }) => (
        <li key={String(doc.docId)} className={deadline.tone}>
          <Link href="/me/profile?tab=documents">
            <span className="prof-attn-t" {...bidiProps(String(doc.title))}>{String(doc.title)}</span>
            <span className="prof-attn-d">{deadline.text}</span>
          </Link>
        </li>
      ))}

      {missingSections.length > 0 && (
        <li className="">
          <Link href="/me/profile?tab=info">
            <span className="prof-attn-t">
              {missingSections.map((s) => SECTION_LABEL[s] ?? s).join('، ')}
            </span>
            <span className="prof-attn-d">هنوز پر نشده</span>
          </Link>
        </li>
      )}

      {!storageConfigured && (
        <li className="">
          <Link href="/me/profile?tab=documents">
            <span className="prof-attn-t">پیوست فایل غیرفعال است</span>
            <span className="prof-attn-d" {...bidiProps(storageReason || 'S3 تنظیم نشده')}>
              {storageReason || 'S3 تنظیم نشده'}
            </span>
          </Link>
        </li>
      )}
    </ul>
  );
}
