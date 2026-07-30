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
  identity: 'هویت', contact: 'راه‌های تماس', residency: 'اقامت و مهاجرت',
  education: 'تحصیلات', languages: 'زبان‌ها', credentials: 'گواهی‌نامه‌ها',
  employment: 'سوابق شغلی', skills: 'مهارت‌ها', financial: 'اطلاعات مالی', assets: 'دارایی‌ها',
  legal: 'حقوقی', health_ref: 'ارجاع سلامت', memberships: 'عضویت‌ها', achievements: 'دستاوردها',
  preferences: 'ترجیحات', goals: 'اهداف', capabilities: 'توانمندی‌ها',
  governance: 'حاکمیت', operations: 'عملیات',
};

/** One line explaining what each section is FOR — shown when it is empty. */
export const SECTION_PURPOSE: Record<string, string> = {
  identity: 'نام رسمی فارسی و لاتین، مشخصات شناسنامه‌ای، ملیت — پایهٔ هر تأیید هویتی و هر فرم رسمی.',
  contact: 'ایمیل، تلفن، نشانی و تماس اضطراری — تا سیستم بداند چطور به شما یا از طرف شما ارتباط بگیرد.',
  residency: 'کشور محل اقامت، نوع اقامت، ویزا و تاریخ انقضای آن‌ها — چیزهایی که دیر شدنشان جبران‌ناپذیر است.',
  education: 'مقاطع، دانشگاه‌ها و تاریخ‌ها — همان چیزی که در ارزیابی مدرک و مهاجرت خواسته می‌شود.',
  languages: 'زبان‌ها و سطح رسمی‌شان (CEFR، آیلتس، تافل) با تاریخ اعتبار آزمون.',
  credentials: 'گواهی‌نامه‌های حرفه‌ای، شمارهٔ گواهی و لینک راستی‌آزمایی.',
  employment: 'نقش‌ها، شرکت‌ها، تاریخ‌ها و دستاوردها — مبنای رزومه و تأییدیهٔ سابقه.',
  skills: 'کاری که واقعاً بلدید — مبنای واگذاری کار به شما یا به جای شما.',
  financial: 'حساب‌ها، شبا و شناسهٔ مالیاتی. پیش‌فرض خصوصی می‌ماند.',
  assets: 'دارایی‌های ثبت‌شده، سهم مالکیت و شمارهٔ ثبت.',
  legal: 'پرونده‌ها، قراردادها، طرف مقابل و مهلت‌های حقوقی.',
  health_ref: 'اطلاعات حیاتی برای شرایط اضطراری و بیمه. حساس است و خصوصی می‌ماند.',
  memberships: 'عضویت در سازمان‌ها و انجمن‌های حرفه‌ای.',
  achievements: 'جوایز، انتشارات و دستاوردهای قابل استناد.',
  goals: 'آنچه می‌خواهید به آن برسید — سیستم کارها را به همین وصل می‌کند.',
  capabilities: 'اختیارات و توانایی‌هایی که به سیستم داده‌اید.',
  preferences: 'زبان، تقویم، ساعات کاری و کانال ارتباطی مرجّح شما.',
};

/* ------------------------------------------------------------ field catalogue */

export type FieldType = 'text' | 'longtext' | 'date' | 'select' | 'email' | 'phone' | 'url' | 'number';

export interface FieldSpec {
  label: string;
  type: FieldType;
  /** For `select`: the allowed values, stored as `id`, displayed as `fa`. */
  options?: Array<{ id: string; fa: string }>;
  placeholder?: string;
  /** A one-line explanation when the field is not self-evident. */
  hint?: string;
  /** Machine identifiers (IBAN, passport number, ids) are always ltr. */
  ltr?: boolean;
}

const GENDER = [
  { id: 'male', fa: 'مرد' }, { id: 'female', fa: 'زن' }, { id: 'other', fa: 'سایر' },
  { id: 'undisclosed', fa: 'ترجیح می‌دهم نگویم' },
];
const MARITAL = [
  { id: 'single', fa: 'مجرد' }, { id: 'married', fa: 'متأهل' },
  { id: 'divorced', fa: 'مطلقه' }, { id: 'widowed', fa: 'همسر فوت‌شده' },
];
const MILITARY = [
  { id: 'completed', fa: 'پایان خدمت' }, { id: 'exempt_permanent', fa: 'معافیت دائم' },
  { id: 'exempt_education', fa: 'معافیت تحصیلی' }, { id: 'serving', fa: 'در حال خدمت' },
  { id: 'liable', fa: 'مشمول' }, { id: 'not_applicable', fa: 'مشمول نیستم' },
];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ id: b, fa: b }));
const RESIDENCY_STATUS = [
  { id: 'citizen', fa: 'شهروند' }, { id: 'permanent_resident', fa: 'اقامت دائم' },
  { id: 'temporary_resident', fa: 'اقامت موقت' }, { id: 'work_permit', fa: 'مجوز کار' },
  { id: 'student', fa: 'اقامت تحصیلی' }, { id: 'visitor', fa: 'ویزای بازدید' },
  { id: 'applicant', fa: 'در حال درخواست' }, { id: 'none', fa: 'ندارم' },
];
const DEGREE = [
  { id: 'diploma', fa: 'دیپلم' }, { id: 'associate', fa: 'کاردانی' }, { id: 'bachelor', fa: 'کارشناسی' },
  { id: 'master', fa: 'کارشناسی ارشد' }, { id: 'phd', fa: 'دکتری' }, { id: 'postdoc', fa: 'پسادکتری' },
  { id: 'certificate', fa: 'دورهٔ تخصصی' },
];
const CEFR = [
  { id: 'A1', fa: 'A1 — مقدماتی' }, { id: 'A2', fa: 'A2 — پایه' }, { id: 'B1', fa: 'B1 — متوسط' },
  { id: 'B2', fa: 'B2 — متوسط بالا' }, { id: 'C1', fa: 'C1 — پیشرفته' }, { id: 'C2', fa: 'C2 — تسلط کامل' },
  { id: 'native', fa: 'زبان مادری' },
];
const EMPLOYMENT_TYPE = [
  { id: 'full_time', fa: 'تمام‌وقت' }, { id: 'part_time', fa: 'پاره‌وقت' },
  { id: 'contract', fa: 'قراردادی' }, { id: 'freelance', fa: 'آزاد' },
  { id: 'founder', fa: 'بنیان‌گذار' }, { id: 'internship', fa: 'کارآموزی' },
];
const SKILL_LEVEL = [
  { id: 'beginner', fa: 'مقدماتی' }, { id: 'intermediate', fa: 'متوسط' },
  { id: 'advanced', fa: 'پیشرفته' }, { id: 'expert', fa: 'خبره' },
];
const LEGAL_STATUS = [
  { id: 'draft', fa: 'پیش‌نویس' }, { id: 'active', fa: 'جاری' }, { id: 'pending', fa: 'در انتظار' },
  { id: 'closed', fa: 'مختومه' }, { id: 'disputed', fa: 'مورد اختلاف' },
];
const YES_NO = [{ id: 'yes', fa: 'بله' }, { id: 'no', fa: 'خیر' }];
const CALENDAR = [{ id: 'jalali', fa: 'شمسی' }, { id: 'gregorian', fa: 'میلادی' }];

/**
 * The field catalogue (D-187e).
 *
 * Real paperwork, not a demo schema. Two things drove these choices:
 *
 *  - **Persian and Latin names are different data.** Every visa form, bank and
 *    airline needs the passport transliteration, and every Iranian document
 *    needs the Persian original. Storing one and hoping is how names end up
 *    mismatched across applications.
 *  - **A date the owner can miss is a first-class field**, not a note: permit
 *    and visa expiry, insurance validity, test-score validity. Those feed the
 *    same expiry watch that already guards documents.
 *
 * `type` drives BOTH the editor control and how the value is displayed, so a
 * date gets a date picker and an enum can never be misspelled into a value the
 * system cannot read back.
 */
export const FIELD_SPEC: Record<string, FieldSpec> = {
  /* --- identity ------------------------------------------------------- */
  full_name_fa: { label: 'نام کامل (فارسی)', type: 'text', placeholder: 'احسان رحیمی' },
  full_name_en: { label: 'نام کامل (لاتین، مطابق پاسپورت)', type: 'text', ltr: true, placeholder: 'EHSAN RAHIMI', hint: 'دقیقاً همان‌طور که در پاسپورت نوشته شده — اختلاف املا در فرم‌های رسمی دردسر می‌سازد.' },
  full_name: { label: 'نام کامل', type: 'text' },
  first_name: { label: 'نام', type: 'text' },
  last_name: { label: 'نام خانوادگی', type: 'text' },
  display_name: { label: 'نام نمایشی', type: 'text' },
  father_name: { label: 'نام پدر', type: 'text' },
  mother_name: { label: 'نام مادر', type: 'text' },
  national_id: { label: 'کد ملی', type: 'text', ltr: true },
  id_card_number: { label: 'شمارهٔ شناسنامه', type: 'text', ltr: true },
  id_card_issue_place: { label: 'محل صدور شناسنامه', type: 'text' },
  passport_no: { label: 'شمارهٔ پاسپورت', type: 'text', ltr: true },
  birth_date: { label: 'تاریخ تولد (میلادی)', type: 'date' },
  birth_date_jalali: { label: 'تاریخ تولد (شمسی)', type: 'text', ltr: true, placeholder: '1369/01/22' },
  dob: { label: 'تاریخ تولد', type: 'date' },
  birth_place: { label: 'محل تولد', type: 'text' },
  nationality: { label: 'ملیت', type: 'text' },
  second_nationality: { label: 'ملیت دوم', type: 'text' },
  gender: { label: 'جنسیت', type: 'select', options: GENDER },
  marital_status: { label: 'وضعیت تأهل', type: 'select', options: MARITAL },
  children_count: { label: 'تعداد فرزندان', type: 'number' },
  military_status: { label: 'وضعیت خدمت سربازی', type: 'select', options: MILITARY },
  blood_type: { label: 'گروه خونی', type: 'select', options: BLOOD },

  /* --- contact -------------------------------------------------------- */
  email: { label: 'ایمیل', type: 'email', ltr: true },
  email_work: { label: 'ایمیل کاری', type: 'email', ltr: true },
  phone: { label: 'تلفن', type: 'phone', ltr: true },
  mobile: { label: 'موبایل', type: 'phone', ltr: true },
  mobile_2: { label: 'موبایل دوم', type: 'phone', ltr: true },
  address: { label: 'نشانی', type: 'longtext' },
  city: { label: 'شهر', type: 'text' },
  province: { label: 'استان', type: 'text' },
  country: { label: 'کشور', type: 'text' },
  postal_code: { label: 'کد پستی', type: 'text', ltr: true },
  timezone: { label: 'منطقهٔ زمانی', type: 'text', ltr: true, placeholder: 'Asia/Tehran' },
  website: { label: 'وب‌سایت', type: 'url', ltr: true },
  linkedin: { label: 'لینکدین', type: 'url', ltr: true },
  github: { label: 'گیت‌هاب', type: 'url', ltr: true },
  telegram: { label: 'تلگرام', type: 'text', ltr: true },
  whatsapp: { label: 'واتس‌اپ', type: 'phone', ltr: true },
  instagram: { label: 'اینستاگرام', type: 'text', ltr: true },
  emergency_contact_name: { label: 'تماس اضطراری — نام', type: 'text' },
  emergency_contact_phone: { label: 'تماس اضطراری — تلفن', type: 'phone', ltr: true },
  emergency_contact_relation: { label: 'تماس اضطراری — نسبت', type: 'text' },
  preferred_channel: { label: 'کانال ارتباطی مرجّح', type: 'text' },

  /* --- residency & immigration ---------------------------------------- */
  country_of_residence: { label: 'کشور محل اقامت', type: 'text' },
  residency_status: { label: 'وضعیت اقامت', type: 'select', options: RESIDENCY_STATUS },
  residence_permit_no: { label: 'شمارهٔ کارت/مجوز اقامت', type: 'text', ltr: true },
  residence_permit_expires: { label: 'انقضای مجوز اقامت', type: 'date', hint: 'برای این تاریخ هشدار انقضا فعال می‌شود.' },
  visa_type: { label: 'نوع ویزا', type: 'text', ltr: true },
  visa_expires: { label: 'انقضای ویزا', type: 'date' },
  entry_date: { label: 'تاریخ ورود', type: 'date' },
  tax_residency: { label: 'اقامت مالیاتی', type: 'text' },
  immigration_case_no: { label: 'شمارهٔ پروندهٔ مهاجرتی', type: 'text', ltr: true },
  immigration_lawyer: { label: 'وکیل مهاجرت', type: 'text' },

  /* --- education & languages ------------------------------------------ */
  degree: { label: 'مقطع', type: 'select', options: DEGREE },
  field: { label: 'رشته', type: 'text' },
  university: { label: 'دانشگاه', type: 'text' },
  institution: { label: 'مؤسسه', type: 'text' },
  graduation_year: { label: 'سال فارغ‌التحصیلی', type: 'number' },
  gpa: { label: 'معدل', type: 'text', ltr: true },
  thesis_title: { label: 'عنوان پایان‌نامه', type: 'text' },
  language: { label: 'زبان', type: 'text' },
  languages: { label: 'زبان‌ها', type: 'text' },
  language_level: { label: 'سطح (CEFR)', type: 'select', options: CEFR },
  test_name: { label: 'نام آزمون', type: 'text', ltr: true, placeholder: 'IELTS' },
  test_score: { label: 'نمرهٔ آزمون', type: 'text', ltr: true },
  test_date: { label: 'تاریخ آزمون', type: 'date' },
  test_expires: { label: 'اعتبار آزمون تا', type: 'date' },

  /* --- credentials ---------------------------------------------------- */
  credential_id: { label: 'شمارهٔ گواهی', type: 'text', ltr: true },
  issuer: { label: 'صادرکننده', type: 'text' },
  issue_date: { label: 'تاریخ صدور', type: 'date' },
  expiry_date: { label: 'تاریخ انقضا', type: 'date' },
  verification_url: { label: 'لینک راستی‌آزمایی', type: 'url', ltr: true },

  /* --- employment ----------------------------------------------------- */
  company: { label: 'شرکت', type: 'text' },
  role: { label: 'نقش', type: 'text' },
  title: { label: 'عنوان', type: 'text' },
  position: { label: 'سمت', type: 'text' },
  employment_type: { label: 'نوع همکاری', type: 'select', options: EMPLOYMENT_TYPE },
  industry: { label: 'صنعت', type: 'text' },
  is_current: { label: 'شغل فعلی', type: 'select', options: YES_NO },
  responsibilities: { label: 'مسئولیت‌ها', type: 'longtext' },
  achievements: { label: 'دستاوردها', type: 'longtext' },
  manager: { label: 'مدیر مستقیم', type: 'text' },
  reference_contact: { label: 'تماس معرّف', type: 'text' },
  start_date: { label: 'تاریخ شروع', type: 'date' },
  end_date: { label: 'تاریخ پایان', type: 'date' },
  years: { label: 'سال‌ها', type: 'number' },

  /* --- skills --------------------------------------------------------- */
  skill: { label: 'مهارت', type: 'text' },
  category: { label: 'دسته', type: 'text' },
  level: { label: 'سطح', type: 'select', options: SKILL_LEVEL },
  last_used: { label: 'آخرین استفاده', type: 'date' },
  evidence_url: { label: 'لینک نمونه‌کار', type: 'url', ltr: true },

  /* --- financial ------------------------------------------------------ */
  bank: { label: 'بانک', type: 'text' },
  bank_name: { label: 'نام بانک', type: 'text' },
  account_holder: { label: 'صاحب حساب', type: 'text' },
  iban: { label: 'شبا / IBAN', type: 'text', ltr: true },
  account: { label: 'شمارهٔ حساب', type: 'text', ltr: true },
  swift_bic: { label: 'سوئیفت / BIC', type: 'text', ltr: true },
  currency: { label: 'ارز', type: 'text', ltr: true },
  tax_id: { label: 'شناسهٔ مالیاتی', type: 'text', ltr: true },
  crypto_wallet: { label: 'کیف پول رمزارز', type: 'text', ltr: true },

  /* --- assets & legal ------------------------------------------------- */
  asset_type: { label: 'نوع دارایی', type: 'text' },
  location: { label: 'موقعیت', type: 'text' },
  value: { label: 'ارزش', type: 'number' },
  ownership_share: { label: 'سهم مالکیت (٪)', type: 'number' },
  registry_no: { label: 'شمارهٔ ثبت', type: 'text', ltr: true },
  acquired_date: { label: 'تاریخ تملک', type: 'date' },
  counterparty: { label: 'طرف مقابل', type: 'text' },
  jurisdiction: { label: 'حوزهٔ قضایی', type: 'text' },
  lawyer_name: { label: 'وکیل', type: 'text' },
  lawyer_contact: { label: 'تماس وکیل', type: 'text' },
  reference: { label: 'شماره / سریال', type: 'text', ltr: true },
  reference_no: { label: 'شمارهٔ پرونده', type: 'text', ltr: true },
  due_date: { label: 'مهلت', type: 'date' },

  /* --- health --------------------------------------------------------- */
  allergies: { label: 'حساسیت‌ها', type: 'longtext' },
  chronic_conditions: { label: 'بیماری‌های مزمن', type: 'longtext' },
  medications: { label: 'داروهای جاری', type: 'longtext' },
  insurance_provider: { label: 'بیمه‌گر', type: 'text' },
  insurance_no: { label: 'شمارهٔ بیمه', type: 'text', ltr: true },
  insurance_expires: { label: 'انقضای بیمه', type: 'date' },
  doctor_name: { label: 'پزشک معالج', type: 'text' },
  doctor_phone: { label: 'تلفن پزشک', type: 'phone', ltr: true },

  /* --- goals, capabilities, preferences, misc ------------------------- */
  target_date: { label: 'تاریخ هدف', type: 'date' },
  success_metric: { label: 'معیار موفقیت', type: 'text' },
  priority: { label: 'اولویت', type: 'text' },
  scope: { label: 'دامنه', type: 'text' },
  constraints: { label: 'محدودیت‌ها', type: 'longtext' },
  organization: { label: 'سازمان', type: 'text' },
  member_no: { label: 'شمارهٔ عضویت', type: 'text', ltr: true },
  ui_language: { label: 'زبان رابط', type: 'text' },
  calendar: { label: 'تقویم', type: 'select', options: CALENDAR },
  working_hours: { label: 'ساعات کاری', type: 'text' },
  notes: { label: 'یادداشت', type: 'longtext' },
  description: { label: 'توضیح', type: 'longtext' },
  summary: { label: 'خلاصه', type: 'longtext' },
  status: { label: 'وضعیت', type: 'select', options: LEGAL_STATUS },
  url: { label: 'لینک', type: 'url', ltr: true },
  date: { label: 'تاریخ', type: 'date' },
};

/**
 * Fields offered per section. An empty editor asking for a "key" is a blank
 * page problem — the owner would have to invent both the schema and the
 * content. These are OFFERS, not a schema: anything else can still be typed,
 * and nothing here is required.
 */
export const SECTION_FIELDS: Record<string, string[]> = {
  identity: [
    'full_name_fa', 'full_name_en', 'first_name', 'last_name', 'father_name', 'mother_name',
    'national_id', 'id_card_number', 'id_card_issue_place', 'passport_no',
    'birth_date', 'birth_date_jalali', 'birth_place', 'nationality', 'second_nationality',
    'gender', 'marital_status', 'children_count', 'military_status', 'blood_type',
  ],
  contact: [
    'email', 'email_work', 'mobile', 'mobile_2', 'phone',
    'address', 'city', 'province', 'country', 'postal_code', 'timezone',
    'website', 'linkedin', 'github', 'telegram', 'whatsapp', 'instagram',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'preferred_channel',
  ],
  residency: [
    'country_of_residence', 'residency_status', 'residence_permit_no', 'residence_permit_expires',
    'visa_type', 'visa_expires', 'entry_date', 'tax_residency', 'immigration_case_no', 'immigration_lawyer',
  ],
  education: ['degree', 'field', 'university', 'country', 'city', 'start_date', 'graduation_year', 'gpa', 'thesis_title'],
  languages: ['language', 'language_level', 'test_name', 'test_score', 'test_date', 'test_expires'],
  credentials: ['title', 'issuer', 'credential_id', 'issue_date', 'expiry_date', 'verification_url'],
  employment: ['company', 'role', 'employment_type', 'industry', 'country', 'city', 'start_date', 'end_date', 'is_current', 'responsibilities', 'achievements', 'manager', 'reference_contact'],
  skills: ['skill', 'category', 'level', 'years', 'last_used', 'evidence_url'],
  financial: ['bank_name', 'account_holder', 'iban', 'account', 'swift_bic', 'currency', 'tax_id', 'crypto_wallet'],
  assets: ['title', 'asset_type', 'description', 'location', 'value', 'currency', 'ownership_share', 'registry_no', 'acquired_date'],
  legal: ['title', 'counterparty', 'status', 'reference_no', 'jurisdiction', 'lawyer_name', 'lawyer_contact', 'start_date', 'due_date', 'notes'],
  health_ref: ['blood_type', 'allergies', 'chronic_conditions', 'medications', 'insurance_provider', 'insurance_no', 'insurance_expires', 'doctor_name', 'doctor_phone'],
  memberships: ['organization', 'role', 'member_no', 'start_date', 'end_date', 'status'],
  achievements: ['title', 'description', 'issuer', 'date', 'url'],
  goals: ['title', 'description', 'category', 'target_date', 'success_metric', 'priority'],
  capabilities: ['title', 'description', 'level', 'scope', 'constraints'],
  preferences: ['ui_language', 'calendar', 'timezone', 'working_hours', 'preferred_channel', 'currency'],
};

/** The spec for a key, or null when it is one the owner invented. */
export function fieldSpec(key: string): FieldSpec | null {
  return FIELD_SPEC[key] ?? FIELD_SPEC[key.toLowerCase()] ?? null;
}

/** Display text for a stored enum value (`male` → `مرد`). */
export function optionLabel(key: string, value: unknown): string | null {
  const spec = fieldSpec(key);
  if (!spec?.options) return null;
  return spec.options.find((o) => o.id === String(value))?.fa ?? null;
}

/** `passport_no` → `Passport No`; used only when we have no curated label. */
export function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function fieldLabel(key: string): string {
  return fieldSpec(key)?.label ?? humanise(key);
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
export function valueKind(v: unknown, key?: string): ValueKind {
  // A declared field type wins over sniffing: `test_score: "7"` is a score, not
  // a number to be reformatted, and `visa_type: "B1"` is not a CEFR level.
  const spec = key ? fieldSpec(key) : null;
  if (spec) {
    if (spec.type === 'date') return 'date';
    if (spec.type === 'email') return 'email';
    if (spec.type === 'url') return 'url';
    if (spec.type === 'phone') return 'phone';
    if (spec.type === 'number') return 'number';
  }
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

/**
 * Display text for a value that belongs to a KNOWN field: an enum id becomes
 * its Persian label, everything else falls through to `formatValue`. Storage
 * keeps the stable id (`male`), never the translated word — the display layer
 * is where language happens.
 */
export function formatFieldValue(key: string, v: unknown): string {
  return optionLabel(key, v) ?? formatValue(v);
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
