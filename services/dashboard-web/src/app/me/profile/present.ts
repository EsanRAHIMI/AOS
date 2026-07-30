/**
 * Presentation layer for the owner's profile (D-187).
 *
 * The previous page rendered storage shapes directly: a profile section became
 * a table row reading `passport_no: X · dob: Y`, a history entry read
 * `document.created`, an attestation read `claimType` + a raw entity id. That
 * is a database browser, not a profile — it forces the owner to mentally
 * decode their own identity.
 *
 * Everything here is pure and deterministic (no I/O, no dates-in-render
 * surprises beyond an injectable `now`), so it is unit-testable and safe to
 * run on the server. Rules it follows:
 *
 *  - Never invent. An unknown key is shown humanised, not hidden or renamed
 *    into a guess — new sections must degrade gracefully, since the CIN graph
 *    is designed to grow shapes we have not seen yet.
 *  - Say the consequence, not the record type: "۱۲ روز تا انقضا" beats
 *    `document_expiring`.
 *  - Keep the technical truth available; just stop leading with it.
 */

/* ------------------------------------------------------------------ labels */

export const SECTION_LABEL: Record<string, string> = {
  identity: 'هویت', contact: 'راه‌های تماس', education: 'تحصیلات', credentials: 'گواهی‌نامه‌ها',
  employment: 'سوابق شغلی', skills: 'مهارت‌ها', financial: 'اطلاعات مالی', assets: 'دارایی‌ها',
  legal: 'حقوقی', health_ref: 'ارجاع سلامت', memberships: 'عضویت‌ها', achievements: 'دستاوردها',
  preferences: 'ترجیحات', goals: 'اهداف', capabilities: 'توانمندی‌ها',
  governance: 'حاکمیت', operations: 'عملیات',
};

/** One line explaining what each section is FOR — shown when it is empty. */
export const SECTION_PURPOSE: Record<string, string> = {
  identity: 'نام رسمی، تاریخ تولد، ملیت — پایهٔ هر تأیید هویتی.',
  contact: 'ایمیل، تلفن، نشانی — تا سیستم بداند چطور به شما یا از طرف شما ارتباط بگیرد.',
  education: 'مدارک و مقاطع تحصیلی.',
  credentials: 'گواهی‌نامه‌های حرفه‌ای و تخصصی.',
  employment: 'نقش‌ها و سوابق کاری.',
  skills: 'کاری که واقعاً بلدید — مبنای واگذاری کار به شما یا به جای شما.',
  financial: 'حساب‌ها و اطلاعات مالی پایه. پیش‌فرض خصوصی می‌ماند.',
  assets: 'دارایی‌های ثبت‌شده.',
  legal: 'وضعیت حقوقی، قراردادها، تعهدات.',
  goals: 'آنچه می‌خواهید به آن برسید — سیستم کارها را به همین وصل می‌کند.',
  capabilities: 'اختیارات و توانایی‌هایی که به سیستم داده‌اید.',
};

/**
 * Fields worth offering per section (D-187d).
 *
 * An empty editor asking for a "key" is a blank page problem: the owner has to
 * invent both the schema and the content. These are OFFERS, not a schema —
 * anything else can still be typed, and nothing here is required.
 */
export const SECTION_FIELDS: Record<string, string[]> = {
  identity: ['full_name', 'first_name', 'last_name', 'national_id', 'birth_date', 'birth_place', 'nationality', 'gender'],
  contact: ['email', 'phone', 'mobile', 'address', 'city', 'country', 'postal_code', 'timezone', 'website', 'linkedin', 'github'],
  education: ['degree', 'field', 'university', 'graduation_year', 'gpa'],
  credentials: ['title', 'institution', 'reference', 'start_date', 'end_date'],
  employment: ['company', 'role', 'title', 'start_date', 'end_date', 'summary'],
  skills: ['skill', 'level', 'years', 'languages'],
  financial: ['bank', 'iban', 'account', 'currency'],
  assets: ['title', 'description', 'value', 'currency'],
  legal: ['title', 'status', 'reference', 'notes'],
  goals: ['title', 'description', 'end_date'],
  capabilities: ['title', 'description', 'level'],
  memberships: ['institution', 'role', 'start_date', 'end_date'],
  achievements: ['title', 'description', 'end_date'],
  preferences: ['language', 'timezone', 'notes'],
};

/** Field labels seen in practice. Unknown keys fall back to humanise(). */
const FIELD_LABEL: Record<string, string> = {
  full_name: 'نام کامل', first_name: 'نام', last_name: 'نام خانوادگی', display_name: 'نام نمایشی',
  father_name: 'نام پدر', national_id: 'کد ملی', passport_no: 'شمارهٔ پاسپورت',
  birth_date: 'تاریخ تولد', dob: 'تاریخ تولد', birth_place: 'محل تولد',
  nationality: 'ملیت', citizenship: 'تابعیت', gender: 'جنسیت', marital_status: 'وضعیت تأهل',
  email: 'ایمیل', phone: 'تلفن', mobile: 'موبایل', telegram: 'تلگرام', whatsapp: 'واتس‌اپ',
  address: 'نشانی', city: 'شهر', country: 'کشور', postal_code: 'کد پستی', timezone: 'منطقهٔ زمانی',
  website: 'وب‌سایت', linkedin: 'لینکدین', github: 'گیت‌هاب',
  degree: 'مدرک', field: 'رشته', university: 'دانشگاه', institution: 'مؤسسه',
  graduation_year: 'سال فارغ‌التحصیلی', gpa: 'معدل',
  company: 'شرکت', role: 'نقش', title: 'عنوان', position: 'سمت',
  start_date: 'تاریخ شروع', end_date: 'تاریخ پایان', years: 'سال‌ها',
  language: 'زبان', languages: 'زبان‌ها', level: 'سطح',
  bank: 'بانک', iban: 'شبا', account: 'حساب', currency: 'ارز',
  notes: 'یادداشت', description: 'توضیح', summary: 'خلاصه', status: 'وضعیت',
};

/** `passport_no` → `Passport No`; used only when we have no curated label. */
export function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? FIELD_LABEL[key.toLowerCase()] ?? humanise(key);
}

export const VISIBILITY_LABEL: Record<string, string> = {
  private: 'فقط خودم', restricted: 'با اجازهٔ موردی', network: 'طرف‌های متصل', public: 'عمومی',
};

export const VISIBILITY_HINT: Record<string, string> = {
  private: 'هیچ سرویس یا طرف بیرونی این بخش را نمی‌بیند.',
  restricted: 'هر بار اشتراک‌گذاری نیازمند تأیید شماست.',
  network: 'موجودیت‌های متصل در شبکه می‌توانند ببینند.',
  public: 'برای همه قابل مشاهده است.',
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  identity: 'هویتی', education: 'تحصیلی', employment: 'شغلی', financial: 'مالی',
  legal: 'حقوقی', medical: 'درمانی', contract: 'قرارداد', license: 'مجوز', other: 'سایر',
};

/* ------------------------------------------------------------- value shape */

export type ValueKind = 'date' | 'email' | 'url' | 'phone' | 'number' | 'boolean' | 'list' | 'text';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const PHONE = /^[+()\d][\d\s()+-]{6,}$/;

/**
 * Classify a stored value so the UI can render it appropriately (a date as a
 * date, a link as a link) instead of stringifying everything.
 */
export function valueKind(v: unknown): ValueKind {
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  const s = String(v ?? '').trim();
  if (ISO_DATE.test(s)) return 'date';
  if (EMAIL.test(s)) return 'email';
  if (URL_RE.test(s)) return 'url';
  if (PHONE.test(s)) return 'phone';
  return 'text';
}

/** Display string for a stored value. Objects become compact JSON, never "[object Object]". */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join('، ');
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return ISO_DATE.test(s) ? s.slice(0, 10) : s;
}

/* --------------------------------------------------------------- deadlines */

/**
 * Whole days until `iso`; negative when it is already past.
 *
 * Deliberately floors rather than rounds: for a deadline the error must be in
 * the safe direction. With 5.5 days left, "5 روز" is a fair warning and
 * "6 روز" is a small lie that tells the owner they have more time than they do.
 */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((t - now) / 86_400_000);
}

export interface Deadline {
  text: string;
  tone: 'ok' | 'warn' | 'err' | '';
  /** Sort weight: the most urgent thing first, undated last. */
  urgency: number;
}

/**
 * The consequence in plain Persian. This is the single most important string
 * on the documents tab — it is what makes an expiry legible at a glance.
 */
export function expiryPhrase(expiresAt: string | null | undefined, status: string, now = Date.now()): Deadline {
  if (status === 'archived') return { text: 'بایگانی‌شده', tone: '', urgency: 9_000 };
  if (status === 'superseded') return { text: 'نسخهٔ جدیدتری دارد', tone: '', urgency: 8_000 };
  const d = daysUntil(expiresAt, now);
  if (d === null) return { text: 'بدون تاریخ انقضا', tone: '', urgency: 5_000 };
  if (d < 0) return { text: `${Math.abs(d)} روز است که منقضی شده`, tone: 'err', urgency: -10_000 + d };
  if (d === 0) return { text: 'امروز منقضی می‌شود', tone: 'err', urgency: 0 };
  if (d <= 14) return { text: `${d} روز تا انقضا`, tone: 'err', urgency: d };
  if (d <= 45) return { text: `${d} روز تا انقضا`, tone: 'warn', urgency: d };
  return { text: `معتبر تا ${String(expiresAt).slice(0, 10)}`, tone: 'ok', urgency: d };
}

/* ----------------------------------------------------------------- history */

/**
 * Ledger record types → a sentence the owner can read.
 * The raw type stays available for the technical disclosure.
 */
const RECORD_SENTENCE: Record<string, string> = {
  'entity.created': 'هویت شما در شبکه ثبت شد',
  'entity.updated': 'اطلاعات هویتی شما به‌روزرسانی شد',
  'entity.section.updated': 'یک بخش از پروفایل شما ویرایش شد',
  'entity.status.changed': 'وضعیت هویت شما تغییر کرد',
  'claim.issued': 'یک تأیید امضاشده دربارهٔ شما صادر شد',
  'claim.revoked': 'یک تأیید دربارهٔ شما باطل شد',
  'relation.created': 'یک ارتباط جدید در شبکه ثبت شد',
  'relation.ended': 'یک ارتباط در شبکه پایان یافت',
  'document.created': 'مدرک جدیدی ثبت شد',
  'document.updated': 'اطلاعات یک مدرک ویرایش شد',
  'document.archived': 'مدرکی بایگانی شد',
  'document.file.attached': 'فایل یک مدرک بارگذاری شد',
  'key.registered': 'کلید امضای جدیدی ثبت شد',
  'key.rotated': 'کلید امضای شما تعویض شد',
};

export function recordSentence(recordType: string): string {
  return RECORD_SENTENCE[recordType] ?? humanise(recordType.replace(/\./g, ' '));
}

/** Coarse grouping used for the timeline marker. */
export function recordGroup(recordType: string): 'profile' | 'document' | 'trust' | 'network' {
  if (recordType.startsWith('document.')) return 'document';
  if (recordType.startsWith('claim.') || recordType.startsWith('key.')) return 'trust';
  if (recordType.startsWith('relation.')) return 'network';
  return 'profile';
}

/** "امروز" / "دیروز" / "۳ روز پیش" / an absolute date beyond a month. */
export function whenPhrase(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return 'امروز';
  if (days === 1) return 'دیروز';
  if (days < 30) return `${days} روز پیش`;
  return iso.slice(0, 10);
}

/* ------------------------------------------------------------ attestations */

const CLAIM_SENTENCE: Record<string, string> = {
  identity_verified: 'هویت شما تأیید شده است',
  education_verified: 'مدرک تحصیلی شما تأیید شده است',
  employment_verified: 'سابقهٔ شغلی شما تأیید شده است',
  skill_verified: 'یک مهارت شما تأیید شده است',
  membership: 'عضویت شما تأیید شده است',
  reputation: 'اعتبار شما ثبت شده است',
  ownership: 'مالکیت شما بر یک دارایی تأیید شده است',
  capability: 'یک توانمندی برای شما به رسمیت شناخته شده است',
};

export function claimSentence(claimType: string): string {
  return CLAIM_SENTENCE[claimType] ?? humanise(claimType);
}

/* -------------------------------------------------------------- completion */

/** Sections a personal profile is expected to have before it is useful. */
export const CORE_SECTIONS = ['identity', 'contact', 'education', 'employment', 'skills', 'goals'] as const;

export interface Completeness {
  filled: number;
  total: number;
  percent: number;
  missing: string[];
}

export function completeness(sections: Record<string, unknown> | undefined): Completeness {
  const present = new Set(Object.keys(sections ?? {}));
  const missing = CORE_SECTIONS.filter((s) => !present.has(s));
  const filled = CORE_SECTIONS.length - missing.length;
  return {
    filled,
    total: CORE_SECTIONS.length,
    percent: Math.round((filled / CORE_SECTIONS.length) * 100),
    missing: [...missing],
  };
}

/** Initials for the avatar. Works for Persian and Latin names alike. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return '؟';
  return parts.map((p) => Array.from(p)[0] ?? '').join('');
}
