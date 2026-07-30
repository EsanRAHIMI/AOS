/**
 * D-187 — the profile actually renders.
 *
 * Typecheck proves the props line up and `next build` proves it compiles;
 * neither proves the components survive REAL data, which is where this page
 * previously hurt: a section with an object value, a document with no issuer
 * and no file, a ledger record type nobody has seen. These render the true
 * markup (server components, static render) and assert the owner-visible text.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdentityHeader, TabBar, TechnicalDetails } from '../src/app/me/profile/shell';
import { SectionCard, DocumentCard, HistoryTimeline, AttentionList, AttestationRow } from '../src/app/me/profile/views';
import { completeness, expiryPhrase } from '../src/app/me/profile/present';

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('identity header', () => {
  it('shows the name, membership date and actionable counters', () => {
    const out = html(
      <IdentityHeader
        name="احسان رحیمی"
        entityId="cin_ent_abc123"
        status="active"
        since="2026-07-01"
        completeness={completeness({ identity: {}, contact: {} })}
        attention={2}
        attestations={1}
        documents={5}
      />,
    );
    expect(out).toContain('احسان رحیمی');
    expect(out).toContain('عضو شبکه از 2026-07-01');
    expect(out).toContain('فعال');
    expect(out).toContain('نیازمند توجه');
    // Counters must be links into the tab that fixes them.
    expect(out).toContain('href="/me/profile?tab=documents"');
    // Completeness prompts the next step rather than only scoring.
    expect(out).toContain('33٪ کامل');
    expect(out).toContain('4 بخش پایه باقی مانده');
  });

  it('says the base is complete instead of nagging at 100%', () => {
    const full = completeness({ identity: {}, contact: {}, education: {}, employment: {}, skills: {}, goals: {} });
    const out = html(
      <IdentityHeader name="Ehsan" entityId="e1" status="active" since="2026-01-01"
        completeness={full} attention={0} attestations={0} documents={0} />,
    );
    expect(out).toContain('بخش‌های پایه کامل است');
    expect(out).not.toContain('باقی مانده');
  });
});

describe('tabs', () => {
  it('marks the active tab and links the rest', () => {
    const out = html(<TabBar tabs={[{ id: 'overview', label: 'نمای کلی' }, { id: 'info', label: 'اطلاعات من' }]} active="info" />);
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('href="/me/profile?tab=info"');
    // The default tab links to the bare URL, so it is not a dead ?tab=overview.
    expect(out).toContain('href="/me/profile"');
  });
});

describe('section cards', () => {
  it('renders labelled fields, not key:value soup', () => {
    const out = html(
      <SectionCard
        entityId="e1"
        name="identity"
        section={{
          data: { full_name: 'احسان رحیمی', passport_no: 'K12345678', dob: '1990-04-11T00:00:00.000Z' },
          visibility: 'private', version: 3, updatedAt: '2026-07-20T10:00:00.000Z', attestedBy: [],
        }}
      />,
    );
    expect(out).toContain('هویت');
    expect(out).toContain('نام کامل');
    expect(out).toContain('شمارهٔ پاسپورت');
    expect(out).toContain('1990-04-11');       // timestamp trimmed to a date
    expect(out).toContain('فقط خودم');          // visibility in plain words
    expect(out).not.toContain('full_name');     // raw key never leads
    expect(out).toContain('v3');                // version stays, as secondary meta
  });

  it('survives an object-valued field instead of printing [object Object]', () => {
    const out = html(
      <SectionCard entityId="e1" name="employment"
        section={{ data: { company: { name: 'AOS', id: 7 } }, visibility: 'network', version: 1, updatedAt: '2026-07-20T10:00:00.000Z', attestedBy: [] }} />,
    );
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('AOS');
  });

  it('turns an empty section into an invitation that explains why it matters', () => {
    const out = html(<SectionCard entityId="e1" name="skills" section={null} />);
    expect(out).toContain('مهارت‌ها');
    expect(out).toContain('افزودن مهارت‌ها');
    expect(out).toContain('کاری که واقعاً بلدید');
  });

  it('marks an attested section', () => {
    const out = html(
      <SectionCard entityId="e1" name="education"
        section={{ data: { degree: 'MSc' }, visibility: 'public', version: 2, updatedAt: '2026-07-20T10:00:00.000Z', attestedBy: ['cin_ent_uni'] }} />,
    );
    expect(out).toContain('تأییدشده');
  });
});

describe('document cards', () => {
  it('leads with the deadline in days, not the raw status', () => {
    const doc = { docId: 'doc1', title: 'پاسپورت', docType: 'identity', issuer: 'وزارت امور خارجه', status: 'expiring', expiresAt: '2026-08-05T00:00:00.000Z', file: null };
    const out = html(<DocumentCard doc={doc} deadline={expiryPhrase(doc.expiresAt, doc.status, NOW)} />);
    expect(out).toContain('5 روز تا انقضا');
    expect(out).toContain('هویتی');
    expect(out).toContain('وزارت امور خارجه');
    expect(out).toContain('بدون فایل — رکورد پایش می‌شود');
    expect(out).not.toContain('expiring');
  });

  it('renders a bare document (no issuer, no reference, no expiry) without empty rows', () => {
    const doc = { docId: 'doc2', title: 'Contract', docType: 'contract', status: 'active', expiresAt: null, file: null };
    const out = html(<DocumentCard doc={doc} deadline={expiryPhrase(null, 'active', NOW)} />);
    expect(out).toContain('بدون تاریخ انقضا');
    expect(out).not.toContain('صادرکننده');
    expect(out).not.toContain('شماره<');
  });
});

describe('history timeline', () => {
  it('reads as sentences with relative time', () => {
    const out = html(
      <HistoryTimeline records={[
        { ledgerId: 'l1', recordType: 'document.created', summary: 'passport', at: '2026-07-29T10:00:00.000Z' },
        { ledgerId: 'l2', recordType: 'claim.issued', summary: 'verified', at: '2026-07-20T10:00:00.000Z' },
      ]} />,
    );
    expect(out).toContain('مدرک جدیدی ثبت شد');
    expect(out).toContain('یک تأیید امضاشده دربارهٔ شما صادر شد');
    expect(out).not.toContain('document.created');
    expect(out).toContain('prof-tl-document');
    expect(out).toContain('prof-tl-trust');
  });
});

describe('attention list', () => {
  it('lists what is wrong, each row linking to where it is fixed', () => {
    const out = html(
      <AttentionList
        items={[{ doc: { docId: 'd1', title: 'پاسپورت' }, deadline: expiryPhrase('2026-06-01T00:00:00.000Z', 'expired', NOW) }]}
        missingSections={['skills', 'goals']}
        storageConfigured={false}
        storageReason="AWS_S3_BUCKET تنظیم نشده"
      />,
    );
    expect(out).toContain('پاسپورت');
    expect(out).toContain('روز است که منقضی شده');
    expect(out).toContain('مهارت‌ها، اهداف');
    expect(out).toContain('پیوست فایل غیرفعال است');
    expect(out).toContain('href="/me/profile?tab=info"');
  });

  it('states plainly that nothing needs attention rather than inventing activity', () => {
    const out = html(<AttentionList items={[]} missingSections={[]} storageConfigured storageReason="" />);
    expect(out).toContain('همه‌چیز مرتب است');
  });
});

describe('attestations and technical disclosure', () => {
  it('explains a claim and marks a revoked one', () => {
    const ok = html(<AttestationRow claim={{ claimId: 'c1', claimType: 'identity_verified', issuerEntityId: 'cin_ent_gov', issuedAt: '2026-07-29T10:00:00.000Z' }} />);
    expect(ok).toContain('هویت شما تأیید شده است');
    expect(ok).toContain('دیروز');

    const revoked = html(<AttestationRow claim={{ claimId: 'c2', claimType: 'skill_verified', issuerEntityId: 'x', revokedAt: '2026-07-30T00:00:00.000Z' }} />);
    expect(revoked).toContain('باطل شده');
    expect(revoked).toContain('revoked');
  });

  it('keeps ids, keys and the storage location available but collapsed', () => {
    const out = html(
      <TechnicalDetails entityId="cin_ent_abc" entityType="person" status="active"
        createdAt="2026-07-01T00:00:00.000Z" sectionCount={4}
        publicKey={{ keyId: 'k1', alg: 'Ed25519', publicKeyPem: '...' }}
        storage={{ configured: false, reason: 'AWS_S3_BUCKET missing', bucket: '', region: '' }} />,
    );
    expect(out).toContain('<details');            // collapsed by default
    expect(out).toContain('جزئیات فنی');
    expect(out).toContain('cin_ent_abc');
    expect(out).toContain('Ed25519');
    expect(out).toContain('AWS_S3_BUCKET missing');
    expect(out).toContain('MongoDB Atlas');       // honest about where data lives
  });
});
