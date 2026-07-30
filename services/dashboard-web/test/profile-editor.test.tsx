/**
 * D-187d — the editors must not live inside the card they edit.
 *
 * The bug being locked out: the section editor expanded inline in a ~290px
 * grid cell, overflowed it and collided with neighbouring cards. The fix is
 * structural (a native `<dialog>`, which renders in the top layer), so the
 * test is structural too: a closed editor contributes only its trigger, and
 * the form markup lives inside a `<dialog>` rather than in the card's flow.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionCard } from '../src/app/me/profile/views';
import { SectionEditor, AddDocument } from '../src/app/me/profile/controls';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const SECTION = {
  data: { full_name: 'احسان رحیمی', role: 'Founder & System Architect' },
  visibility: 'network', version: 1, updatedAt: '2026-07-19T10:00:00.000Z', attestedBy: [],
};

describe('section editor', () => {
  it('renders the form inside a <dialog>, never in the card body', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={SECTION.data} visibility="network" />);
    expect(out).toContain('<dialog');
    // The dialog is closed on first paint — no `open` attribute is emitted, so
    // nothing shows until showModal() runs.
    expect(out).not.toContain('<dialog open');
    // Every input belongs to the dialog subtree, not to the page flow.
    const dialogStart = out.indexOf('<dialog');
    expect(out.indexOf('<input')).toBeGreaterThan(dialogStart);
  });

  it('shows only a trigger button in the card footer', () => {
    const out = html(<SectionCard entityId="e1" name="identity" section={SECTION} />);
    const footer = out.slice(out.indexOf('prof-sec-foot'));
    // The card footer's own controls: the trigger, plus the version meta.
    expect(footer).toContain('ویرایش');
    expect(footer).toContain('prof-sec-meta');
  });

  it('labels both halves of a field row and previews how the key will read', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={{ full_name: 'احسان' }} visibility="private" />);
    expect(out).toContain('نام فیلد');
    expect(out).toContain('مقدار');
    expect(out).toContain('نمایش: نام کامل');   // key → human label, before saving
  });

  it('offers section-appropriate fields and hides ones already present', () => {
    const out = html(<SectionEditor entityId="e1" section="contact" initial={{ email: 'a@b.com' }} visibility="private" />);
    expect(out).toContain('افزودن سریع:');
    expect(out).toContain('تلفن');       // suggested, not yet present
    expect(out).toContain('نشانی');
    // `email` is already a row, so it must not also be offered.
    const suggest = out.slice(out.indexOf('prof-suggest'));
    expect(suggest).not.toContain('>ایمیل<');
  });

  it('keeps the key input ltr and the value input direction-aware', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={{ full_name: 'احسان رحیمی' }} visibility="private" />);
    // Keys are always machine identifiers.
    expect(out).toContain('placeholder="email" dir="ltr"');
    // The value carries the direction of what it holds.
    expect(out).toContain('dir="rtl"');
  });

  it('explains that saving replaces the section — versioning is not a surprise', () => {
    const out = html(<SectionEditor entityId="e1" section="skills" initial={{}} visibility="private" />);
    expect(out).toContain('به‌طور کامل جایگزین');
    expect(out).toContain('هنوز فیلدی ندارد');
  });
});

describe('add document', () => {
  it('also opens in a dialog with labelled controls', () => {
    const out = html(<AddDocument ownerEntityId="e1" />);
    expect(out).toContain('<dialog');
    expect(out).not.toContain('<dialog open');
    expect(out).toContain('عنوان مدرک');
    expect(out).toContain('تاریخ انقضا');
    expect(out).toContain('فایل اختیاری است');
  });

  it('every control is reachable by its label (htmlFor/id pairing)', () => {
    const out = html(<AddDocument ownerEntityId="e1" />);
    const ids = [...out.matchAll(/<(?:input|select) id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) expect(out).toContain(`for="${id}"`);
  });
});
