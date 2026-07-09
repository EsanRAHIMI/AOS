/**
 * Phase AF.2 — small, shared, typed parsers for the numbers/tags the
 * backend already encodes into a `ZoneItem.detail` string (e.g.
 * `"income opportunity · impact 7/10"`, `"category · score 8.4"`,
 * `"family · event · due 2026-07-20"`). One place for this instead of each
 * domain visual re-inventing its own regex — real data only: every value
 * returned here was authored by `buildUniverseZones()` in
 * shared/src/personal/index.ts, nothing is invented client-side.
 */

/** Pulls the first decimal number following `keyword` in `detail`, e.g.
 *  `extractNumberAfter('category · score 8.4', 'score')` → 8.4. */
export function extractNumberAfter(detail: string, keyword: string): number | null {
  const re = new RegExp(`${keyword}\\s*([\\d.]+)`, 'i');
  const m = detail.match(re);
  return m ? Number(m[1]) : null;
}

/** The leading `x · y · z` segment before the first separator — used for
 *  category tags like `"family"` in `"family · event · due 2026-07-20"`. */
export function firstSegment(detail: string): string {
  return detail.split('·')[0]?.trim() ?? '';
}

/** All `·`-separated segments, trimmed. */
export function segments(detail: string): string[] {
  return detail.split('·').map((s) => s.trim()).filter(Boolean);
}
