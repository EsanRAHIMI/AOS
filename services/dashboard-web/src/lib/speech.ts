/**
 * Persian speech shaping (D-195).
 *
 * The browser's speech synthesis is free and offline-capable, which is why we
 * use it. What it is not is smart: hand it a markdown answer and it will read
 * the asterisks, spell a time as "ten colon thirty", run four sentences
 * together without breathing, and — on a long string — stop dead partway
 * through, a well-known engine bug.
 *
 * So the naturalness has to come from the text we hand it. Everything here is
 * pure and tested: normalisation, voice choice, and chunking.
 */

/** A voice we would actually let speak Persian. */
export interface VoiceLike { name: string; lang: string; localService?: boolean; default?: boolean }

/**
 * Choose a voice.
 *
 * A Persian sentence read by an English voice is not accented — it is
 * unintelligible noise, letter salad. So the rule is exact-language or
 * nothing: if the system has no Persian voice we return null and the caller
 * stays silent rather than producing gibberish the owner has to sit through.
 */
export function pickVoice(voices: VoiceLike[], lang: string): VoiceLike | null {
  const base = lang.split('-')[0].toLowerCase();
  const sameLang = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(base));
  if (sameLang.length === 0) return null;

  // Google's cloud voices are markedly more natural than the bundled
  // formant-synthesis ones, so prefer them when present.
  const score = (v: VoiceLike): number => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (n.includes('google')) s += 40;
    if (n.includes('natural') || n.includes('neural') || n.includes('premium') || n.includes('enhanced')) s += 30;
    if (v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) s += 10;
    if (v.default) s += 5;
    if (n.includes('compact')) s -= 20;   // Apple's low-quality tier
    return s;
  };
  return [...sameLang].sort((a, b) => score(b) - score(a))[0];
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Turn a written answer into something worth hearing.
 *
 * Order matters: strip structure first, then expand what should be spoken as
 * words, then fix the pauses.
 */
export function speechText(input: string): string {
  let t = input;

  // Fenced code and inline code are not speech. Say so once instead of
  // reading a hundred symbols out loud.
  t = t.replace(/```[\s\S]*?```/g, ' (بلوک کد) ');
  t = t.replace(/`([^`]{1,40})`/g, '$1');
  t = t.replace(/`[^`]*`/g, ' (کد) ');

  // Markdown furniture.
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, '$1$2');
  t = t.replace(/^\s*[-•*]\s+/gm, '');
  t = t.replace(/^\s*\|.*\|\s*$/gm, ' ');
  t = t.replace(/^\s*>+\s?/gm, '');
  t = t.replace(/^\s*[-=]{3,}\s*$/gm, ' ');

  // Times: "14:30" spoken as digits is "one four three zero". As words it is
  // a time. This is the single biggest naturalness win for a calendar agent.
  t = t.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/g, (_m, h: string, m: string) => (
    m === '00' ? `ساعت ${Number(h)}` : `ساعت ${Number(h)} و ${Number(m)} دقیقه`
  ));

  // ISO dates read as a date, not as a subtraction.
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y: string, mo: string, d: string) => `${Number(d)}/${Number(mo)}/${y}`);

  // Persian digits confuse some engines' number handling; ASCII is safer.
  t = t.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

  // Symbols that should be heard as a breath, not as a name.
  t = t.replace(/\s[—–]\s/g, '، ');
  t = t.replace(/([^\s])\/([^\s])/g, '$1 $2');

  // Emoji and leftover control marks.
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ');

  // A newline is a pause; several newlines are a longer one.
  t = t.replace(/\n{2,}/g, '. ');
  t = t.replace(/\n/g, '، ');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\s+([،.!?؟:])/g, '$1');
  t = t.replace(/([،.!?؟])\1+/g, '$1');

  return t.trim();
}

/**
 * Split into utterances the engine will actually finish.
 *
 * Chrome silently truncates long utterances (~15s / a few hundred chars), and
 * queueing sentence-sized pieces both dodges that and gives natural sentence
 * boundaries. Splitting is on punctuation, never mid-word.
 */
export function chunkForSpeech(text: string, max = 180): string[] {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?؟])\s+/);
  const out: string[] = [];
  let buf = '';

  const push = (s: string) => { if (s.trim()) out.push(s.trim()); };

  for (const sentence of sentences) {
    let s = sentence;
    // A sentence longer than the cap is split at commas, then at spaces —
    // anywhere but inside a word.
    while (s.length > max) {
      const slice = s.slice(0, max);
      const cut = Math.max(slice.lastIndexOf('، '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
      const at = cut > max * 0.4 ? cut : max;
      push(buf); buf = '';
      push(s.slice(0, at));
      s = s.slice(at).trim();
    }
    if ((buf + ' ' + s).trim().length > max) { push(buf); buf = s; }
    else buf = (buf ? `${buf} ${s}` : s);
  }
  push(buf);
  return out;
}

/**
 * The sentence Jarvis says before an event.
 *
 * Spoken, not written: no bullet points, no field labels, and the detail the
 * owner needs to decide whether to move — how long, where, with whom.
 */
export function alertSentence(e: {
  summary?: string; start?: string; end?: string; location?: string;
  attendees?: unknown[]; hangoutLink?: string; description?: string;
}, minutes: number): string {
  const title = (e.summary || 'یک رویداد').trim();
  const lead = minutes <= 0
    ? `${title} همین الان شروع می‌شود`
    : minutes === 1
      ? `${title} یک دقیقهٔ دیگر شروع می‌شود`
      : `${title} ${minutes} دقیقهٔ دیگر شروع می‌شود`;

  const parts = [lead];
  if (e.start && e.end) {
    const mins = Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000);
    if (mins > 0 && mins < 1440) parts.push(mins >= 60 && mins % 60 === 0 ? `${mins / 60} ساعت طول می‌کشد` : `${mins} دقیقه طول می‌کشد`);
  }
  if (e.location) parts.push(`مکان: ${e.location}`);
  if (e.hangoutLink) parts.push('لینک میت دارد');
  if (Array.isArray(e.attendees) && e.attendees.length > 0) parts.push(`${e.attendees.length} مهمان دارد`);
  if (e.description) parts.push(String(e.description).replace(/\s+/g, ' ').slice(0, 160));

  return `${parts.join('، ')}.`;
}
