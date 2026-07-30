/**
 * Assistant reply structure (D-189).
 *
 * Jarvis answers were rendered as one `<p>` of raw text, so a reply listing
 * eleven identity facts arrived as a single wall of prose with " - " separators
 * running inline. The information was right and unreadable.
 *
 * This module turns a reply into BLOCKS. It is a deliberate, small parser
 * rather than a markdown dependency:
 *
 *  - The output is a data structure, not HTML, so the renderer can build React
 *    elements and never touch `dangerouslySetInnerHTML`. Model output is
 *    untrusted input; it must not be able to inject markup.
 *  - It handles the shape models actually produce in this system — including
 *    the inline `- a - b - c` run above, which no markdown parser recovers
 *    because it is not, syntactically, a list.
 *  - `label: value` lines become a real key/value block, because most of what
 *    this assistant reports is facts about records.
 *
 * Pure and deterministic: same text ⇒ same blocks.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'code'; v: string };

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; spans: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbers'; items: Inline[][] }
  | { type: 'facts'; rows: Array<{ label: string; value: Inline[] }> }
  | { type: 'quote'; spans: Inline[] }
  | { type: 'code'; text: string };

/* ------------------------------------------------------------------ inline */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

/** Split a line into text / bold / code spans. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: 'text', v: text.slice(last, i) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ t: 'strong', v: tok.slice(2, -2) });
    else out.push({ t: 'code', v: tok.slice(1, -1) });
    last = i + tok.length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out.length ? out : [{ t: 'text', v: text }];
}

/* ------------------------------------------------------------ line shapes */

const BULLET = /^\s*[-*•–]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const HEADING_HASH = /^\s*#{1,4}\s+(.*)$/;
/** `**Section:**` or `Section:` alone on a line, short enough to be a title. */
const HEADING_BOLD = /^\s*\*\*(.+?)\*\*:?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
/** `label: value` — the label must be short, or every sentence becomes a row. */
const FACT = /^(.{1,42}?)\s*[:：]\s+(.+)$/;

/**
 * Recover list items from a paragraph that uses inline dashes as separators.
 *
 * Models in this system routinely emit «… به شرح زیر است: - نام: x - نقش: y».
 * That is a list to a human and a single line to any parser, so it is split
 * here — but only with 2+ separators, so an ordinary hyphenated sentence is
 * left alone.
 */
export function splitInlineDashRun(line: string): string[] | null {
  const parts = line.split(/\s+[-–—]\s+/);
  if (parts.length < 3) return null;
  const items = parts.slice(1).map((p) => p.trim()).filter(Boolean);
  if (items.length < 2) return null;
  const lead = parts[0].trim();
  return lead ? [lead, ...items] : items;
}

/** A heading's trailing colon belongs to the sentence it replaced, not to the
 *  title — `**قدم بعدی:**` and `## قدم بعدی` must render identically. */
function headingText(raw: string): string {
  return raw.trim().replace(/\s*[:：]\s*$/, '');
}

/* ------------------------------------------------------------------ blocks */

export function parseBlocks(input: string): Block[] {
  const text = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const blocks: Block[] = [];
  const lines = text.split('\n');

  let bullets: Inline[][] = [];
  let numbers: Inline[][] = [];
  let facts: Array<{ label: string; value: Inline[] }> = [];
  let para: string[] = [];

  const flushBullets = () => { if (bullets.length) { blocks.push({ type: 'bullets', items: bullets }); bullets = []; } };
  const flushNumbers = () => { if (numbers.length) { blocks.push({ type: 'numbers', items: numbers }); numbers = []; } };
  const flushFacts = () => { if (facts.length) { blocks.push({ type: 'facts', rows: facts }); facts = []; } };
  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(' ').trim();
    para = [];
    if (!joined) return;
    // Last chance to rescue an inline list before it becomes a wall of prose.
    const run = splitInlineDashRun(joined);
    if (run) {
      const [lead, ...items] = run.length > 1 && !FACT.test(run[0]) ? run : ['', ...run];
      if (lead) blocks.push({ type: 'paragraph', spans: parseInline(lead) });
      pushItems(items);
      return;
    }
    blocks.push({ type: 'paragraph', spans: parseInline(joined) });
  };
  const flushAll = () => { flushBullets(); flushNumbers(); flushFacts(); flushPara(); };

  /** Route a set of list items to facts or bullets depending on their shape. */
  function pushItems(items: string[]) {
    const asFacts = items.map((i) => i.match(FACT)).filter(Boolean) as RegExpMatchArray[];
    if (asFacts.length >= Math.max(2, Math.ceil(items.length * 0.6))) {
      blocks.push({
        type: 'facts',
        rows: items.map((i) => {
          const m = i.match(FACT);
          return m ? { label: m[1].replace(/\*\*/g, '').trim(), value: parseInline(m[2].trim()) }
            : { label: '', value: parseInline(i) };
        }),
      });
      return;
    }
    blocks.push({ type: 'bullets', items: items.map((i) => parseInline(i)) });
  }

  let inCode = false;
  let code: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*```/.test(line)) {
      if (inCode) { blocks.push({ type: 'code', text: code.join('\n') }); code = []; inCode = false; }
      else { flushAll(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(rawLine); continue; }

    if (!line.trim()) { flushAll(); continue; }

    const hash = line.match(HEADING_HASH);
    if (hash) { flushAll(); blocks.push({ type: 'heading', text: headingText(hash[1]) }); continue; }

    const bold = line.match(HEADING_BOLD);
    if (bold) { flushAll(); blocks.push({ type: 'heading', text: headingText(bold[1]) }); continue; }

    const quote = line.match(QUOTE);
    if (quote) { flushAll(); blocks.push({ type: 'quote', spans: parseInline(quote[1]) }); continue; }

    const num = line.match(NUMBERED);
    if (num) { flushBullets(); flushFacts(); flushPara(); numbers.push(parseInline(num[2].trim())); continue; }

    const bul = line.match(BULLET);
    if (bul) {
      flushNumbers(); flushPara();
      const item = bul[1].trim();
      const fact = item.match(FACT);
      if (fact) { flushBullets(); facts.push({ label: fact[1].replace(/\*\*/g, '').trim(), value: parseInline(fact[2].trim()) }); }
      else { flushFacts(); bullets.push(parseInline(item)); }
      continue;
    }

    flushBullets(); flushNumbers(); flushFacts();
    para.push(line.trim());
  }

  if (inCode && code.length) blocks.push({ type: 'code', text: code.join('\n') });
  flushAll();
  return blocks;
}

/** Plain text of a block set — used for copy-to-clipboard and tests. */
export function blocksToPlainText(blocks: Block[]): string {
  const inline = (spans: Inline[]) => spans.map((s) => s.v).join('');
  return blocks.map((b) => {
    switch (b.type) {
      case 'heading': return b.text;
      case 'paragraph': return inline(b.spans);
      case 'quote': return `> ${inline(b.spans)}`;
      case 'code': return b.text;
      case 'bullets': return b.items.map((i) => `- ${inline(i)}`).join('\n');
      case 'numbers': return b.items.map((i, n) => `${n + 1}. ${inline(i)}`).join('\n');
      case 'facts': return b.rows.map((r) => (r.label ? `${r.label}: ${inline(r.value)}` : inline(r.value))).join('\n');
    }
  }).join('\n\n');
}
