'use client';
import Link from 'next/link';
import type { ZoneData } from '../UniverseZone';
import { extractNumberAfter, firstSegment } from '@/lib/zoneParsing';

/**
 * Phase AF.2 — Today & Priorities domain visual.
 *
 * Renders `zone.items` (top ranked next-best-actions, plus an honest
 * overdue-item / pending-approval row when those are real) as a ranked
 * stack: rank number, title, a score bar sized against the batch's own max
 * score (parsed from the real `"category · score X"` detail string the
 * backend already writes), and a category tag. Rows with no parseable score
 * (the overdue/approval special rows) fall back to showing their real
 * detail text instead of a fabricated bar.
 */
export function PriorityStack({ zone }: { zone: ZoneData }) {
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>Nothing ranked yet.</div>;
  }
  const scores = zone.items.map((it) => extractNumberAfter(it.detail, 'score'));
  const maxScore = Math.max(1, ...scores.filter((s): s is number => s !== null));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 0' }}>
      {zone.items.slice(0, 5).map((it, i) => {
        const score = scores[i];
        const cat = score !== null ? firstSegment(it.detail) : null;
        const row = (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="m" style={{ fontSize: 10, width: 14, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
              {score !== null ? (
                <div style={{ height: 4, borderRadius: 2, background: 'var(--glass-2)', overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (score / maxScore) * 100)}%`, background: it.tone === 'warn' ? 'var(--warn)' : it.tone === 'err' ? 'var(--err)' : 'var(--ok)' }} />
                </div>
              ) : (
                <div className="m" style={{ fontSize: 10.5, marginTop: 1 }}>{it.detail}</div>
              )}
            </div>
            {cat && <span className="chip" style={{ fontSize: 9.5, flexShrink: 0, textTransform: 'capitalize' }}>{cat}</span>}
          </div>
        );
        return it.href ? <Link key={i} href={it.href} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link> : <div key={i}>{row}</div>;
      })}
    </div>
  );
}
