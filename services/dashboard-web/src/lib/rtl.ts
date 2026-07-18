/**
 * Bidirectional (RTL) helpers for Persian / Arabic / Hebrew content.
 * Used by AutoDir and the app-wide RtlAutoDir enhancer.
 */

/** Strong RTL scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko, Arabic presentation forms. */
export const RTL_SCRIPT_RE =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Strong LTR letters (Latin + common Latin Extended). */
const LTR_STRONG_RE = /[A-Za-z\u00C0-\u024F]/;

/** True if the string contains any RTL-script character. */
export function containsRtl(text: string): boolean {
  return RTL_SCRIPT_RE.test(text);
}

/**
 * Resolve base direction. If any RTL script is present, prefer `rtl` so
 * Persian/Arabic blocks (including mixed EN prefixes) stay right-aligned.
 */
export function textDirection(text: string): 'rtl' | 'ltr' | 'auto' {
  if (RTL_SCRIPT_RE.test(text)) return 'rtl';
  if (LTR_STRONG_RE.test(text)) return 'ltr';
  return 'auto';
}

/**
 * Props helper for React elements that render free-form user/AI text.
 * Only emits `dir` when RTL is needed — avoids useless `dir="ltr"` and
 * keeps SSR HTML identical to the client render for LTR content.
 */
export function dirProps(text: string | null | undefined): { dir?: 'rtl' } {
  if (!text || !containsRtl(text)) return {};
  return { dir: 'rtl' };
}
