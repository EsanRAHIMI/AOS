/**
 * D-184.1 — provider-scope guard.
 *
 * `UniverseProvider` is mounted by `app/page.tsx` ONLY. A component that calls
 * the strict `useUniverse()` hook therefore renders fine on `/` and throws on
 * every other route — taking the whole page down with
 * "useUniverse() must be called within a UniverseProvider". That is exactly
 * how `/events` and `/operations` broke: both render `<LiveEvents />`, which
 * used the strict hook.
 *
 * This suite is a STATIC guard, not a render test: it reads the source and
 * fails if a shared component reaches for the strict hook again, or if a page
 * outside the homepage renders a component that does. Cheap, fast, and it
 * catches the mistake at the moment it is made rather than in the browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Components allowed to use the strict hook: the homepage tree only. */
const STRICT_ALLOWED = new Set(['HomeLive.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('UniverseProvider scope', () => {
  const files = walk(SRC);

  it('only homepage-tree components use the strict useUniverse() hook', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('UniverseProvider.tsx')) continue; // defines both hooks
      const src = readFileSync(f, 'utf8');
      // Ignore prose in comments; look for a real call site.
      const callsStrict = /(?:^|[^a-zA-Z])useUniverse\s*\(\s*\)/m.test(
        src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
      );
      if (!callsStrict) continue;
      const base = f.split('/').pop()!;
      if (!STRICT_ALLOWED.has(base)) offenders.push(f.replace(SRC, 'src'));
    }
    expect(offenders, 'use useOptionalUniverse() in components reused outside `/`').toEqual([]);
  });

  it('LiveEvents (rendered on /, /events and /operations) stays provider-optional', () => {
    const src = readFileSync(join(SRC, 'components/LiveEvents.tsx'), 'utf8');
    expect(src).toContain('useOptionalUniverse');
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/[^a-zA-Z]useUniverse\s*\(\s*\)/);
  });

  it('exposes both accessors with the intended contract', () => {
    const src = readFileSync(join(SRC, 'components/UniverseProvider.tsx'), 'utf8');
    expect(src).toContain('export function useUniverse()');
    expect(src).toContain('export function useOptionalUniverse()');
    // The optional one must never throw.
    const optional = src.slice(src.indexOf('export function useOptionalUniverse()'));
    expect(optional.slice(0, 200)).not.toContain('throw');
  });
});
