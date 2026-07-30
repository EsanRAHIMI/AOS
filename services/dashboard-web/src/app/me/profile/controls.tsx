'use client';
/**
 * Client controls for the living profile (CIN-1b, D-185).
 *
 * Sections are edited as key/value rows rather than a free JSON textarea: a
 * profile is data the owner reads at a glance and a counterparty may one day
 * verify, so it must not degrade into an unparsed blob. Saving replaces the
 * whole section — the kernel version-bumps it and writes a ledger record.
 */
import { useState } from 'react';
import { saveSectionAction, createDocumentAction, archiveDocumentAction, documentUrlAction } from './actions';
import { bidiProps } from '@/lib/rtl';

type Row = { k: string; v: string };

const VISIBILITY: Array<{ id: string; fa: string }> = [
  { id: 'private', fa: 'خصوصی — فقط من' },
  { id: 'restricted', fa: 'محدود — با اجازهٔ موردی' },
  { id: 'network', fa: 'شبکه — طرف‌های متصل' },
  { id: 'public', fa: 'عمومی' },
];

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
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(initial).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) })));
  const [vis, setVis] = useState(visibility);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg('');
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
    setMsg(res.ok ? 'ذخیره شد — نسخهٔ جدید ثبت و در دفترکل لنگر شد.' : res.error);
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>{label ?? 'ویرایش'}</button>
    );
  }

  return (
    <div className="prof-editor" dir="rtl">
      {rows.map((r, i) => (
        <div key={i} className="prof-row">
          <input
            value={r.k}
            placeholder="کلید"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
            dir="ltr"
          />
          <input
            value={r.v}
            placeholder="مقدار"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
            {...bidiProps(r.v)}
          />
          <button type="button" className="btn btn-ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="prof-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setRows([...rows, { k: '', v: '' }])}>+ فیلد</button>
        <select value={vis} onChange={(e) => setVis(e.target.value)} title="سطح دسترسی این بخش">
          {VISIBILITY.map((v) => <option key={v.id} value={v.id}>{v.fa}</option>)}
        </select>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? '…' : 'ذخیره'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>بستن</button>
      </div>
      {msg && <p className="prof-msg" {...bidiProps(msg)}>{msg}</p>}
    </div>
  );
}

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

export function AddDocument({ ownerEntityId }: { ownerEntityId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', docType: 'identity', issuer: '', reference: '', issuedAt: '', expiresAt: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setBusy(true);
    setMsg('');
    const res = await createDocumentAction({ ownerEntityId, ...form });
    setBusy(false);
    if (res.ok) {
      setForm({ title: '', docType: 'identity', issuer: '', reference: '', issuedAt: '', expiresAt: '', notes: '' });
      setOpen(false);
    } else setMsg(res.error);
  };

  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>+ ثبت مدرک</button>;

  return (
    <div className="prof-editor" dir="rtl">
      <div className="prof-row">
        <input value={form.title} placeholder="عنوان مدرک" onChange={(e) => setForm({ ...form, title: e.target.value })} {...bidiProps(form.title)} />
        <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
          {DOC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.fa}</option>)}
        </select>
      </div>
      <div className="prof-row">
        <input value={form.issuer} placeholder="صادرکننده" onChange={(e) => setForm({ ...form, issuer: e.target.value })} {...bidiProps(form.issuer)} />
        <input value={form.reference} placeholder="شماره / سریال" onChange={(e) => setForm({ ...form, reference: e.target.value })} dir="ltr" />
      </div>
      <div className="prof-row">
        <label className="prof-lbl">صدور<input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} dir="ltr" /></label>
        <label className="prof-lbl">انقضا<input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} dir="ltr" /></label>
      </div>
      <div className="prof-actions">
        <button type="button" className="btn" disabled={busy || !form.title.trim()} onClick={() => void submit()}>{busy ? '…' : 'ثبت'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>انصراف</button>
      </div>
      {msg && <p className="prof-msg">{msg}</p>}
    </div>
  );
}

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
      {msg && <span className="prof-msg">{msg}</span>}
    </span>
  );
}
