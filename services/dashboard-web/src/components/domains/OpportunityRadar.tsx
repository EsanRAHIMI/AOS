'use client';
import Link from 'next/link';
import type { ZoneData } from '../UniverseZone';
import { extractNumberAfter, firstSegment } from '@/lib/zoneParsing';
import { OpportunityDecisionButtons } from '@/app/me/controls';
import { useOptionalRefresh } from '@/components/UniverseProvider';
import { blocksForOpportunityDecision } from '@/lib/realtimeBlocks';

/**
 * Phase AF.2 — Opportunity Radar domain visual.
 *
 * `zone.items` detail strings are `"{category} · value X · conf Y"`, where
 * X/Y are the real `valueScore`/`confidence` computed by `rankOpportunities()`
 * in shared/src/personal — this renders those already-computed scores as
 * ranked dual bars instead of a bullet list, no re-scoring client-side.
 *
 * Phase AF.3 — each item now carries its real `itemId` (opportunityId,
 * previously dropped), so Save/Follow up/Reject (`OpportunityDecisionButtons`,
 * wired to the new opportunity decision endpoint) can render per row.
 */
export function OpportunityRadar({ zone }: { zone: ZoneData }) {
  const refresh = useOptionalRefresh();
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>No upside recorded yet.</div>;
  }
  const maxValue = Math.max(1, ...zone.items.map((it) => extractNumberAfter(it.detail, 'value') ?? 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
      {zone.items.map((it, i) => {
        const value = extractNumberAfter(it.detail, 'value');
        const confidence = extractNumberAfter(it.detail, 'conf');
        const cat = firstSegment(it.detail);
        const row = (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i === 0 ? '★ ' : ''}{it.label}</span>
              {cat && <span className="chip" style={{ fontSize: 9.5, flexShrink: 0, textTransform: 'capitalize' }}>{cat}</span>}
            </div>
            {value !== null && (
              <div style={{ height: 5, borderRadius: 3, background: 'var(--glass-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (value / maxValue) * 100)}%`, background: 'var(--ok)' }} />
              </div>
            )}
            {confidence !== null && <span className="m" style={{ fontSize: 10 }}>confidence {confidence}</span>}
          </div>
        );
        return (
          <div key={i}>
            {it.href ? <Link href={it.href} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link> : row}
            {it.itemId && <div style={{ marginTop: 4 }}><OpportunityDecisionButtons opportunityId={it.itemId} onDecided={() => refresh(blocksForOpportunityDecision())} /></div>}
          </div>
        );
      })}
    </div>
  );
}
