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
 * Field KEYS are a shared vocabulary, not per-user text (D-187f). Nobody types
 * a key here: catalogue fields are added by name, and a genuinely personal
 * field is created from a LABEL whose key is derived and namespaced `x_`. That
 * is what keeps `passport_no` meaning the same thing in every entity — without
 * it, an agent asked for the owner's passport number would be guessing between
 * `passport_no`, `passportNumber` and `pp`, and cross-entity matching would be
 * comparing free text.
 *
 * Saving replaces the whole section; the kernel version-bumps it and writes a
 * ledger record.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { saveSectionAction, createDocumentAction, archiveDocumentAction, documentUrlAction } from './actions';
import { bidiProps } from '@/lib/rtl';
import { SECTION_LABEL, SECTION_FIELDS, fieldLabel, fieldSpec, customKey } from './present';

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

/* ------------------------------------------------------------ value control */

/**
 * The control follows the field's declared TYPE (D-187e): a date gets a date
 * picker, an enum gets a select, a long value gets a textarea. This is not
 * decoration — free text for `gender` or `residency_status` produces values the
 * system cannot read back, and a hand-typed date is the single most common way
 * an expiry watch silently stops working.
 *
 * A key the owner invented has no spec, so it stays a plain direction-aware
 * text box: unknown fields must still be editable, just not second-guessed.
 */
function ValueInput({
  id, fieldKey, value, onChange,
}: {
  id: string;
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const spec = fieldSpec(fieldKey);
  const common = { id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };

  if (spec?.type === 'select' && spec.options) {
    return (
      <select {...common}>
        <option value="">— انتخاب کنید —</option>
        {spec.options.map((o) => <option key={o.id} value={o.id}>{o.fa}</option>)}
      </select>
    );
  }

  if (spec?.type === 'longtext') {
    return <textarea {...common} rows={3} {...bidiProps(value)} placeholder={spec.placeholder} />;
  }

  const type = spec?.type === 'date' ? 'date'
    : spec?.type === 'number' ? 'number'
      : spec?.type === 'email' ? 'email'
        : spec?.type === 'url' ? 'url'
          : spec?.type === 'phone' ? 'tel'
            : 'text';

  // Dates and machine identifiers are always ltr; prose follows its own script.
  const dir = spec?.ltr || spec?.type === 'date' || spec?.type === 'number' ? { dir: 'ltr' as const } : bidiProps(value);

  return <input {...common} type={type} placeholder={spec?.placeholder ?? 'مقدار'} {...dir} />;
}

/* ------------------------------------------------------ custom field adder */

/**
 * The only way to create a field outside the catalogue (D-187f).
 *
 * The owner types a LABEL, never a storage key — the key is derived and
 * namespaced with `x_`, so personal fields can never be confused with the
 * shared vocabulary that agents, attestations and cross-entity matching rely
 * on. Duplicates are rejected here rather than silently overwriting a value.
 */
function CustomFieldAdder({ existing, onAdd }: { existing: string[]; onAdd: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');
  const uid = useId();

  const key = customKey(label);
  const duplicate = key !== null && existing.includes(key);

  const add = () => {
    if (!key) { setErr('یک نام معتبر بنویسید.'); return; }
    if (duplicate) { setErr('فیلدی با همین نام از قبل هست.'); return; }
    onAdd(key);
    setLabel('');
    setErr('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost prof-custom-open" onClick={() => setOpen(true)}>
        + فیلد دلخواه
      </button>
    );
  }

  return (
    <div className="prof-custom">
      <label htmlFor={`${uid}-label`}>نام فیلد دلخواه</label>
      <input
        id={`${uid}-label`}
        value={label}
        placeholder="مثلاً شمارهٔ پروندهٔ بیمه"
        {...bidiProps(label)}
        onChange={(e) => { setLabel(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
      />
      <div className="prof-custom-foot">
        <button type="button" className="btn" onClick={add} disabled={!key || duplicate}>افزودن</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setLabel(''); setErr(''); }}>انصراف</button>
        {/* Say what will be stored. A namespaced key is a promise about how
          * this field is treated later, so it should not be a surprise. */}
        {key && !duplicate && <span className="prof-custom-key" dir="ltr">{key}</span>}
        {(err || duplicate) && <span className="prof-modal-msg err">{err || 'فیلدی با همین نام از قبل هست.'}</span>}
      </div>
    </div>
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
      if (!key) continue;   // defensive: the UI can no longer produce one
      const raw = r.v.trim();
      const spec = fieldSpec(key);
      /* Only a field DECLARED numeric is stored as a number. The previous
       * "looks like a number → make it one" rule quietly corrupted real
       * identifiers: a national id of 0012345678 lost its leading zeros, and
       * an IBAN or phone number could too. Digits are not the same thing as
       * quantities, and identity data is mostly the former. */
      data[key] = spec?.type === 'number' && raw !== '' && !Number.isNaN(Number(raw))
        ? Number(raw)
        : raw;
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

        {/* A row shows its LABEL, never its storage key: keys are a shared
          * vocabulary and renaming one in place would silently orphan the old
          * value. Changing which field this is = remove it and add the right
          * one, which is honest about what actually happens in storage. */}
        <div className="prof-fieldset">
          {rows.map((r, i) => (
            <div key={r.k} className="prof-fedit">
              <div className="prof-fedit-name">
                <label htmlFor={`${uid}-v-${i}`} {...bidiProps(fieldLabel(r.k))}>{fieldLabel(r.k)}</label>
                {!fieldSpec(r.k) && <span className="prof-fedit-tag">دلخواه</span>}
                {fieldSpec(r.k)?.hint && (
                  <span className="prof-fedit-hint" {...bidiProps(fieldSpec(r.k)!.hint!)}>{fieldSpec(r.k)!.hint}</span>
                )}
              </div>

              <div className="prof-fedit-val">
                <ValueInput
                  id={`${uid}-v-${i}`}
                  fieldKey={r.k}
                  value={r.v}
                  onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, v } : x)))}
                />
              </div>

              <button
                type="button"
                className="prof-fedit-x"
                aria-label={`حذف ${fieldLabel(r.k)}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >×</button>
            </div>
          ))}
        </div>

        {suggestions.length > 0 && (
          <div className="prof-suggest">
            <span className="prof-suggest-l">افزودن فیلد:</span>
            {suggestions.map((k) => (
              <button key={k} type="button" className="prof-chip" onClick={() => setRows([...rows, { k, v: '' }])}>
                {fieldLabel(k)}
              </button>
            ))}
          </div>
        )}

        <CustomFieldAdder
          existing={rows.map((r) => r.k)}
          onAdd={(k) => setRows([...rows, { k, v: '' }])}
        />

        <div className="prof-modal-row">
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
