'use client';
/**
 * Client controls for the living profile (D-187d).
 *
 * Previously these editors expanded INSIDE their card. A card is a ~290px grid
 * cell, so the form overflowed it, collided with neighbouring cards and left
 * the fields unreadable — an editor cannot live inside the thing it edits when
 * that thing is a tile.
 *
 * They now open in a native `<dialog>` opened with `showModal()`. That is a
 * deliberate choice over a hand-rolled overlay: the top layer escapes every
 * parent's overflow and stacking context (the exact bug above cannot recur),
 * and Esc-to-close, focus trapping, inertness of the page behind and the
 * `::backdrop` come from the platform rather than from code we would have to
 * maintain.
 *
 * Sections are still edited as key/value rows — a profile may be verified by a
 * counterparty one day, so it must not degrade into an unparsed blob — but the
 * keys are now offered per section and every row shows the human label it will
 * render as. Saving replaces the whole section; the kernel version-bumps it and
 * writes a ledger record.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { saveSectionAction, createDocumentAction, archiveDocumentAction, documentUrlAction } from './actions';
import { bidiProps } from '@/lib/rtl';
import { SECTION_LABEL, SECTION_FIELDS, fieldLabel } from './present';

type Row = { k: string; v: string };

const VISIBILITY: Array<{ id: string; fa: string }> = [
  { id: 'private', fa: 'خصوصی — فقط من' },
  { id: 'restricted', fa: 'محدود — با اجازهٔ موردی' },
  { id: 'network', fa: 'شبکه — طرف‌های متصل' },
  { id: 'public', fa: 'عمومی' },
];

/* -------------------------------------------------------------------- modal */

function Modal({
  open, title, subtitle, onClose, children, footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Keep the DOM's idea of open in sync with React's, both directions.
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="prof-modal"
      dir="rtl"
      // Esc fires `cancel`; let React own the state rather than the DOM.
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A click that lands on the dialog element itself is a backdrop click —
      // the panel inside stops its own clicks from reaching here.
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="prof-modal-panel" onClick={(e) => e.stopPropagation()}>
        <header className="prof-modal-head">
          <div>
            <h2 {...bidiProps(title)}>{title}</h2>
            {subtitle && <p {...bidiProps(subtitle)}>{subtitle}</p>}
          </div>
          <button type="button" className="prof-modal-x" onClick={onClose} aria-label="بستن">×</button>
        </header>

        <div className="prof-modal-body">{children}</div>

        <footer className="prof-modal-foot">{footer}</footer>
      </div>
    </dialog>
  );
}

/* ----------------------------------------------------------- section editor */

export function SectionEditor({
  entityId, section, initial, visibility, label,
}: {
  entityId: string;
  section: string;
  initial: Record<string, unknown>;
  visibility: string;
  /** Trigger text — "افزودن هویت" reads better than "ویرایش" on an empty section. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [vis, setVis] = useState(visibility);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const uid = useId();

  const sectionLabel = SECTION_LABEL[section] ?? section;
  const suggestions = (SECTION_FIELDS[section] ?? []).filter((k) => !rows.some((r) => r.k === k));

  const start = () => {
    // Always reopen from the saved truth, never from an abandoned edit.
    setRows(toRows(initial));
    setVis(visibility);
    setMsg('');
    setErr(false);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setMsg('');
    setErr(false);
    const data: Record<string, unknown> = {};
    for (const r of rows) {
      const key = r.k.trim();
      if (!key) continue;
      // Keep numbers and booleans typed; everything else stays a string.
      const raw = r.v.trim();
      data[key] = raw === 'true' ? true : raw === 'false' ? false
        : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    }
    const res = await saveSectionAction(entityId, section, data, vis);
    setBusy(false);
    if (res.ok) {
      setMsg('ذخیره شد — نسخهٔ جدید ثبت و در دفترکل لنگر شد.');
      setOpen(false);
    } else {
      setErr(true);
      setMsg(res.error);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={start}>{label ?? 'ویرایش'}</button>

      <Modal
        open={open}
        title={sectionLabel}
        subtitle="ذخیره، این بخش را به‌طور کامل جایگزین و نسخهٔ جدیدی ثبت می‌کند."
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              {busy ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>انصراف</button>
            {msg && <span className={`prof-modal-msg${err ? ' err' : ''}`} {...bidiProps(msg)}>{msg}</span>}
          </>
        }
      >
        {rows.length === 0 && (
          <p className="prof-modal-empty">هنوز فیلدی ندارد — یکی از پیشنهادهای زیر را بزنید یا فیلد دلخواه بسازید.</p>
        )}

        <div className="prof-fieldset">
          {rows.map((r, i) => (
            <div key={`${uid}-${i}`} className="prof-fedit">
              <div className="prof-fedit-key">
                <label htmlFor={`${uid}-k-${i}`}>نام فیلد</label>
                <input
                  id={`${uid}-k-${i}`}
                  value={r.k}
                  placeholder="email"
                  dir="ltr"
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
                />
                {/* The owner sees now, not after saving, how this row will read. */}
                <span className="prof-fedit-as" {...bidiProps(r.k ? fieldLabel(r.k) : '')}>
                  {r.k ? `نمایش: ${fieldLabel(r.k)}` : ''}
                </span>
              </div>

              <div className="prof-fedit-val">
                <label htmlFor={`${uid}-v-${i}`}>مقدار</label>
                <input
                  id={`${uid}-v-${i}`}
                  value={r.v}
                  placeholder="مقدار"
                  {...bidiProps(r.v)}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
                />
              </div>

              <button
                type="button"
                className="prof-fedit-x"
                aria-label={`حذف ${r.k ? fieldLabel(r.k) : 'فیلد'}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >×</button>
            </div>
          ))}
        </div>

        {suggestions.length > 0 && (
          <div className="prof-suggest">
            <span className="prof-suggest-l">افزودن سریع:</span>
            {suggestions.map((k) => (
              <button key={k} type="button" className="prof-chip" onClick={() => setRows([...rows, { k, v: '' }])}>
                {fieldLabel(k)}
              </button>
            ))}
          </div>
        )}

        <div className="prof-modal-row">
          <button type="button" className="btn btn-ghost" onClick={() => setRows([...rows, { k: '', v: '' }])}>
            + فیلد دلخواه
          </button>

          <label className="prof-modal-vis">
            <span>چه کسی این بخش را ببیند</span>
            <select value={vis} onChange={(e) => setVis(e.target.value)}>
              {VISIBILITY.map((v) => <option key={v.id} value={v.id}>{v.fa}</option>)}
            </select>
          </label>
        </div>
      </Modal>
    </>
  );
}

function toRows(initial: Record<string, unknown>): Row[] {
  return Object.entries(initial).map(([k, v]) => ({
    k,
    v: typeof v === 'string' ? v : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
  }));
}

/* ------------------------------------------------------------ add document */

const DOC_TYPES: Array<{ id: string; fa: string }> = [
  { id: 'identity', fa: 'هویتی (پاسپورت، کارت ملی)' },
  { id: 'education', fa: 'تحصیلی' },
  { id: 'employment', fa: 'شغلی' },
  { id: 'financial', fa: 'مالی' },
  { id: 'legal', fa: 'حقوقی' },
  { id: 'medical', fa: 'درمانی' },
  { id: 'contract', fa: 'قرارداد' },
  { id: 'license', fa: 'مجوز' },
  { id: 'other', fa: 'سایر' },
];

const EMPTY_DOC = { title: '', docType: 'identity', issuer: '', reference: '', issuedAt: '', expiresAt: '', notes: '' };

export function AddDocument({ ownerEntityId }: { ownerEntityId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_DOC);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const uid = useId();

  const set = (k: keyof typeof EMPTY_DOC) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true);
    setMsg('');
    const res = await createDocumentAction({ ownerEntityId, ...form });
    setBusy(false);
    if (res.ok) {
      setForm(EMPTY_DOC);
      setOpen(false);
    } else setMsg(res.error);
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => { setMsg(''); setOpen(true); }}>+ ثبت مدرک</button>

      <Modal
        open={open}
        title="ثبت مدرک"
        subtitle="فایل اختیاری است — تاریخ انقضا حتی بدون اسکن برای شما پایش می‌شود."
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn" disabled={busy || !form.title.trim()} onClick={() => void submit()}>
              {busy ? 'در حال ثبت…' : 'ثبت'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>انصراف</button>
            {msg && <span className="prof-modal-msg err" {...bidiProps(msg)}>{msg}</span>}
          </>
        }
      >
        <div className="prof-form">
          <label htmlFor={`${uid}-title`}>عنوان مدرک</label>
          <input id={`${uid}-title`} value={form.title} placeholder="پاسپورت" {...bidiProps(form.title)} onChange={set('title')} />

          <label htmlFor={`${uid}-type`}>نوع</label>
          <select id={`${uid}-type`} value={form.docType} onChange={set('docType')}>
            {DOC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.fa}</option>)}
          </select>

          <label htmlFor={`${uid}-issuer`}>صادرکننده</label>
          <input id={`${uid}-issuer`} value={form.issuer} placeholder="وزارت امور خارجه" {...bidiProps(form.issuer)} onChange={set('issuer')} />

          <label htmlFor={`${uid}-ref`}>شماره / سریال</label>
          <input id={`${uid}-ref`} value={form.reference} dir="ltr" onChange={set('reference')} />

          <label htmlFor={`${uid}-issued`}>تاریخ صدور</label>
          <input id={`${uid}-issued`} type="date" value={form.issuedAt} dir="ltr" onChange={set('issuedAt')} />

          <label htmlFor={`${uid}-expires`}>تاریخ انقضا</label>
          <input id={`${uid}-expires`} type="date" value={form.expiresAt} dir="ltr" onChange={set('expiresAt')} />
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------- document actions */

export function DocumentControls({ docId, hasFile }: { docId: string; hasFile: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <span className="prof-doc-actions">
      {hasFile && (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          const url = await documentUrlAction(docId);
          setBusy(false);
          if (url) window.open(url, '_blank', 'noopener');
          else setMsg('فایلی ذخیره نشده یا فضای ذخیره‌سازی تنظیم نیست.');
        }}>دانلود</button>
      )}
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await archiveDocumentAction(docId);
        setBusy(false);
        if (!r.ok) setMsg(r.error);
      }}>بایگانی</button>
      {msg && <span className="prof-msg" {...bidiProps(msg)}>{msg}</span>}
    </span>
  );
}
