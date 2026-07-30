/**
 * D-189 — assistant replies become readable structure.
 *
 * The case that motivated this is the last test: real output from this system,
 * where eleven identity facts arrived as ONE paragraph with " - " separators.
 * No markdown parser recovers that, because syntactically it is not a list —
 * so the recovery is explicit, and pinned here.
 */
import { describe, it, expect } from 'vitest';
import { parseBlocks, parseInline, splitInlineDashRun, blocksToPlainText } from '../src/lib/richtext';

describe('inline spans', () => {
  it('splits bold and code out of plain text', () => {
    expect(parseInline('the `entityId` is **stable**')).toEqual([
      { t: 'text', v: 'the ' },
      { t: 'code', v: 'entityId' },
      { t: 'text', v: ' is ' },
      { t: 'strong', v: 'stable' },
    ]);
  });

  it('leaves ordinary text as a single span', () => {
    expect(parseInline('سلام')).toEqual([{ t: 'text', v: 'سلام' }]);
  });
});

describe('block parsing', () => {
  it('reads headings, paragraphs and bullets', () => {
    const blocks = parseBlocks([
      '## وضعیت',
      'دو مورد نیاز به توجه دارد.',
      '- پاسپورت نزدیک انقضا',
      '- بخش مهارت‌ها خالی است',
    ].join('\n'));

    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bullets']);
    expect(blocks[0]).toEqual({ type: 'heading', text: 'وضعیت' });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('turns `- label: value` lines into a facts table, not bullets', () => {
    const blocks = parseBlocks([
      '- نام کامل: احسان رحیمی',
      '- کد ملی: ثبت شده',
      '- ملیت: ایرانی',
    ].join('\n'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('facts');
    const rows = (blocks[0] as { rows: Array<{ label: string }> }).rows;
    expect(rows.map((r) => r.label)).toEqual(['نام کامل', 'کد ملی', 'ملیت']);
  });

  it('keeps genuine bullets as bullets when they are not label/value', () => {
    const blocks = parseBlocks('- برو به صفحهٔ مدارک\n- پاسپورت را تمدید کن');
    expect(blocks[0].type).toBe('bullets');
  });

  it('handles numbered steps, quotes and code fences', () => {
    const blocks = parseBlocks([
      '1. اول این',
      '2. بعد آن',
      '',
      '> یک نکته',
      '',
      '```',
      'pnpm dev',
      '```',
    ].join('\n'));
    expect(blocks.map((b) => b.type)).toEqual(['numbers', 'quote', 'code']);
    expect((blocks[2] as { text: string }).text).toBe('pnpm dev');
  });

  it('treats a bold line alone as a section heading', () => {
    const blocks = parseBlocks('**قدم بعدی:**\nمدارک را کامل کنید.');
    expect(blocks[0]).toEqual({ type: 'heading', text: 'قدم بعدی' });
  });

  it('returns nothing for empty input rather than an empty paragraph', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('   \n  ')).toEqual([]);
  });
});

describe('inline dash runs — the real-world failure', () => {
  it('recovers a list from a paragraph that used " - " as a separator', () => {
    const items = splitInlineDashRun('به شرح زیر است: - نام: احسان - نقش: بنیان‌گذار - ملیت: ایرانی');
    expect(items).toEqual(['به شرح زیر است:', 'نام: احسان', 'نقش: بنیان‌گذار', 'ملیت: ایرانی']);
  });

  it('leaves an ordinary hyphenated sentence alone', () => {
    expect(splitInlineDashRun('این یک جمله - با یک خط تیره است')).toBeNull();
    expect(splitInlineDashRun('no dashes here at all')).toBeNull();
  });

  it('renders the actual reply from the screenshot as a lead line plus facts', () => {
    const real = 'اطلاعات هویتی ثبت‌شده دربارهٔ شما در سیستم به شرح زیر است: '
      + '- نام کامل: احسان رحیمی (Ehsan Rahimi) - نقش: بنیان‌گذار و معمار سیستم '
      + '- تاریخ تولد: 1367/01/22 - محل تولد: تهران - نام مادر: نیره - نام پدر: عباس '
      + '- ملیت: ایرانی - جنسیت: مرد - وضعیت تأهل: متأهل';

    const blocks = parseBlocks(real);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('facts');

    const rows = (blocks[1] as { rows: Array<{ label: string }> }).rows;
    expect(rows.map((r) => r.label)).toContain('نام کامل');
    expect(rows.map((r) => r.label)).toContain('وضعیت تأهل');
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });
});

describe('round-trip', () => {
  it('can render blocks back to plain text for copying', () => {
    const src = '## عنوان\nمتن.\n- a: 1\n- b: 2';
    expect(blocksToPlainText(parseBlocks(src))).toBe('عنوان\n\nمتن.\n\na: 1\nb: 2');
  });
});
