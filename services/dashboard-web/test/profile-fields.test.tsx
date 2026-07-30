/**
 * D-187e — the field catalogue has to survive real paperwork.
 *
 * The failures worth guarding are the ones that quietly ruin data rather than
 * throw: an identifier coerced into a number and losing its leading zeros, an
 * enum stored as a translated word the system cannot read back, a date typed
 * as free text so the expiry watch never fires.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FIELD_SPEC, SECTION_FIELDS, SECTION_LABEL, SECTION_PURPOSE,
  fieldSpec, fieldLabel, optionLabel, formatFieldValue, valueKind, customKey, isCustomKey,
} from '../src/app/me/profile/present';
import { SectionEditor } from '../src/app/me/profile/controls';
import { SectionCard } from '../src/app/me/profile/views';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('catalogue integrity', () => {
  it('every offered field has a spec — no section can suggest a key it cannot render', () => {
    const orphans: string[] = [];
    for (const [section, keys] of Object.entries(SECTION_FIELDS)) {
      for (const k of keys) if (!fieldSpec(k)) orphans.push(`${section}.${k}`);
    }
    expect(orphans).toEqual([]);
  });

  it('every section that offers fields is named and explained', () => {
    for (const section of Object.keys(SECTION_FIELDS)) {
      expect(SECTION_LABEL[section], `label for ${section}`).toBeTruthy();
      expect(SECTION_PURPOSE[section], `purpose for ${section}`).toBeTruthy();
    }
  });

  it('every select field actually carries its options', () => {
    for (const [key, spec] of Object.entries(FIELD_SPEC)) {
      if (spec.type === 'select') {
        expect(spec.options?.length, `options for ${key}`).toBeGreaterThan(1);
      }
    }
  });

  it('covers the paperwork a real person is actually asked for', () => {
    // Persian AND Latin name: every visa form needs the transliteration and
    // every Iranian document needs the original.
    expect(fieldSpec('full_name_fa')).toBeTruthy();
    expect(fieldSpec('full_name_en')?.ltr).toBe(true);
    // Iranian identity documents are more than a national id.
    for (const k of ['father_name', 'id_card_number', 'military_status', 'birth_date_jalali']) {
      expect(SECTION_FIELDS.identity, k).toContain(k);
    }
    // Residency/immigration exists at all, with the dates that hurt if missed.
    expect(SECTION_FIELDS.residency).toContain('residence_permit_expires');
    expect(SECTION_FIELDS.residency).toContain('visa_expires');
    expect(fieldSpec('visa_expires')?.type).toBe('date');
    // Emergency contact, which is the whole point of having a profile at all
    // on the day something goes wrong.
    expect(SECTION_FIELDS.contact).toContain('emergency_contact_phone');
  });
});

describe('typed values', () => {
  it('shows an enum in Persian while storing the stable id', () => {
    expect(optionLabel('gender', 'male')).toBe('مرد');
    expect(optionLabel('military_status', 'exempt_permanent')).toBe('معافیت دائم');
    expect(formatFieldValue('residency_status', 'permanent_resident')).toBe('اقامت دائم');
    // A value outside the enum is shown as-is rather than dropped.
    expect(formatFieldValue('gender', 'unmapped')).toBe('unmapped');
    // Fields with no options are untouched.
    expect(optionLabel('city', 'Tehran')).toBeNull();
  });

  it('trusts the declared type over sniffing the value', () => {
    // "B1" is a visa class here, not a CEFR level — and not a number.
    expect(valueKind('B1', 'visa_type')).toBe('text');
    // A score of "7" must not be treated as a quantity to reformat.
    expect(valueKind('7', 'test_score')).toBe('text');
    // A declared date stays a date even when stored as a plain day.
    expect(valueKind('2027-01-01', 'visa_expires')).toBe('date');
  });

  it('renders a stored enum id as its Persian label in the card', () => {
    const out = html(
      <SectionCard entityId="e1" name="identity"
        section={{ data: { gender: 'male', marital_status: 'married' }, visibility: 'private', version: 1, updatedAt: '2026-07-20T10:00:00.000Z', attestedBy: [] }} />,
    );
    const displayed = out.slice(out.indexOf('prof-fields'), out.indexOf('prof-sec-foot'));
    expect(displayed).toContain('مرد');
    expect(displayed).toContain('متأهل');
    expect(displayed).not.toContain('>male<');
  });
});

describe('editor controls follow the field type', () => {
  it('gives an enum a select with all its options, not a text box', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={{ military_status: 'completed' }} visibility="private" />);
    expect(out).toContain('<select');
    expect(out).toContain('پایان خدمت');
    expect(out).toContain('معافیت دائم');
    expect(out).toContain('— انتخاب کنید —');
  });

  it('gives a deadline a date picker — a hand-typed date is how an expiry watch dies', () => {
    const out = html(<SectionEditor entityId="e1" section="residency" initial={{ visa_expires: '2027-03-01' }} visibility="private" />);
    expect(out).toContain('type="date"');
    expect(out).toContain('value="2027-03-01"');
  });

  it('gives a long value a textarea', () => {
    const out = html(<SectionEditor entityId="e1" section="health_ref" initial={{ allergies: 'penicillin' }} visibility="private" />);
    expect(out).toContain('<textarea');
  });

  it('shows the field hint where the catalogue has one', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={{ full_name_en: 'EHSAN RAHIMI' }} visibility="private" />);
    expect(out).toContain('دقیقاً همان‌طور که در پاسپورت');
  });

  it('leaves a key outside the catalogue as a plain text box, labelled and tagged', () => {
    const out = html(<SectionEditor entityId="e1" section="identity" initial={{ my_own_field: 'x' }} visibility="private" />);
    expect(out).toContain('My Own Field');   // humanised label
    expect(out).toContain('دلخواه');          // and honestly marked as non-canonical
  });
});

/**
 * D-187f — keys are a shared vocabulary. If every profile invents its own,
 * nothing downstream can rely on them: an agent asked for the passport number
 * would guess between three spellings, an attestation could not name the field
 * it verifies, and cross-entity matching becomes free-text comparison.
 */
describe('key vocabulary', () => {
  it('derives a safe key from a label instead of letting anyone type one', () => {
    expect(customKey('شمارهٔ پروندهٔ بیمه')).toBe('x_شمارهٔ_پروندهٔ_بیمه');
    expect(customKey('My Insurance Ref')).toBe('x_My_Insurance_Ref');
    // ZWNJ is a letter-joining control in Persian, not punctuation: dropping it
    // would glue two words into one.
    expect(customKey('بیمه\u200cنامه')).toBe('x_بیمه\u200cنامه');
  });

  it('never produces a key Mongo would reject or that could shadow a real one', () => {
    // `.` and `$` are illegal in Mongo field names; both must be stripped.
    expect(customKey('a.b$c')).toBe('x_abc');
    expect(customKey('  spaced   out  ')).toBe('x_spaced_out');
    // Nothing usable left → no field, rather than a key named `x_`.
    expect(customKey('...')).toBeNull();
    expect(customKey('   ')).toBeNull();
    // A custom field can never collide with the canonical vocabulary.
    const key = customKey('passport no');
    expect(key).not.toBe('passport_no');
    expect(isCustomKey(key!)).toBe(true);
  });

  it('keeps custom keys distinguishable from catalogue keys forever', () => {
    expect(isCustomKey('x_anything')).toBe(true);
    expect(isCustomKey('passport_no')).toBe(false);
    // …and the catalogue itself must never contain a namespaced key, or the
    // distinction would stop meaning anything.
    expect(Object.keys(FIELD_SPEC).filter(isCustomKey)).toEqual([]);
  });

  it('reconstructs a readable label from a custom key', () => {
    expect(fieldLabel('x_شمارهٔ_پروندهٔ_بیمه')).toBe('شمارهٔ پروندهٔ بیمه');
    expect(fieldLabel('x_My_Insurance_Ref')).toBe('My Insurance Ref');
  });
});

describe('labels', () => {
  it('reads from the catalogue and degrades to humanised English', () => {
    expect(fieldLabel('national_id')).toBe('کد ملی');
    expect(fieldLabel('emergency_contact_phone')).toBe('تماس اضطراری — تلفن');
    expect(fieldLabel('some_unknown_key')).toBe('Some Unknown Key');
  });
});
