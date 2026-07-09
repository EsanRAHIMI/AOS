'use client';
import Link from 'next/link';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.2 — Ventures & Projects domain visual.
 *
 * `zone.items` detail strings are `"income: {low|medium|high} · N goal
 * link(s)"` (shared/src/personal). Renders each active project as a status
 * row with an income-tone indicator and the real goal-link count. The
 * current project contract has no blocker or next-action field — rather
 * than inventing one, each row honestly says "no blocker tracked" /
 * "no goal link yet" when that's genuinely the case.
 */
const INCOME_COLOR: Record<string, string> = { high: 'var(--ok)', medium: 'var(--warn)', low: 'var(--muted, #7a8699)' };

export function VentureBoard({ zone }: { zone: ZoneData }) {
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>No ventures tracked yet.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0' }}>
      {zone.items.map((it, i) => {
        const incomeMatch = it.detail.match(/income:\s*(\w+)/);
        const income = incomeMatch?.[1] ?? 'unknown';
        const goalMatch = it.detail.match(/(\d+)\s*goal link/);
        const goalLinks = goalMatch ? Number(goalMatch[1]) : 0;
        const row = (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'var(--glass-2)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: INCOME_COLOR[income] ?? 'var(--border-2)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              <div className="m" style={{ fontSize: 10 }}>
                {income} income potential · {goalLinks > 0 ? `${goalLinks} goal link${goalLinks === 1 ? '' : 's'}` : 'no goal link yet'} · no blocker tracked
              </div>
            </div>
          </div>
        );
        return it.href ? <Link key={i} href={it.href} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link> : <div key={i}>{row}</div>;
      })}
    </div>
  );
}
