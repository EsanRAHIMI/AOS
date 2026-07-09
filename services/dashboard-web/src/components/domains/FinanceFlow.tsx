'use client';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.1 Step 4 — Finance / Money domain visual.
 *
 * Replaces the generic bullet list with a real inflow/outflow visual, built
 * entirely from the `finance` zone's real `metrics` (in/mo, out/mo, net/mo,
 * obligations — computed by `aggregateFinance()` in shared/src/personal,
 * exposed to this zone for the first time in this phase) and `items`
 * (upcoming obligations, already tagged `tone: 'warn'` by the backend).
 * Lightweight CSS bars — no chart library, consistent with the BodyMap
 * precedent of hand-built visuals over new dependencies. No fake numbers:
 * an honest "not tracked yet" state renders when there is no real amount
 * data, matching the zone's own `setup_needed` status.
 *
 * Phase AF.2 fix: the finance zone's builder (`buildUniverseZones()`) also
 * computes `finRisks` — real financial risk items tagged `tone: 'err'` —
 * but this component only ever read `tone: 'warn'` ("due") items, so risk
 * items were silently dropped even though the backend already computed
 * them. Now both are surfaced, clearly separated.
 */

function metricValue(zone: ZoneData, label: string): string | null {
  const m = zone.metrics.find((x) => x.label === label);
  return m && m.value !== '—' ? m.value : null;
}

export function FinanceFlow({ zone }: { zone: ZoneData }) {
  const inRaw = metricValue(zone, 'in/mo');
  const outRaw = metricValue(zone, 'out/mo');
  const netRaw = metricValue(zone, 'net/mo');
  const obligations = zone.metrics.find((x) => x.label === 'obligations')?.value ?? '0';
  const hasAmounts = inRaw !== null && outRaw !== null;
  const due = zone.items.filter((it) => it.tone === 'warn').slice(0, 3);
  const risks = zone.items.filter((it) => it.tone === 'err').slice(0, 2);

  if (!hasAmounts) {
    // Financial risk items come from the personal graph's risk records, not
    // financeItems, so they can be real even when no amounts are tracked —
    // still surface them rather than dropping them in this branch too.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
        <div style={{ display: 'flex', gap: 4, height: 8, borderRadius: 4, overflow: 'hidden', opacity: 0.35 }}>
          <div style={{ flex: 1, background: 'var(--border-2)' }} />
        </div>
        <span className="m" style={{ fontSize: 11 }}>No amounts tracked yet — cashflow activates the moment you record real numbers.</span>
        {risks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {risks.map((r, i) => (
              <div key={i} style={{ fontSize: 10.5, display: 'flex', gap: 6 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--err)', alignSelf: 'center', flexShrink: 0 }} />
                <span style={{ color: 'var(--err)' }}>{r.label} — <span className="m">{r.detail}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const inflow = Number(inRaw);
  const outflow = Number(outRaw);
  const max = Math.max(inflow, outflow, 1);
  const net = Number(netRaw ?? '0');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }} className="m">
          <span>Inflow</span><span>{inflow}/mo</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--glass-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (inflow / max) * 100)}%`, background: 'var(--ok)', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }} className="m">
          <span>Outflow</span><span>{outflow}/mo</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--glass-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (outflow / max) * 100)}%`, background: 'var(--warn)', borderRadius: 4 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: net >= 0 ? 'var(--ok)' : 'var(--err)' }}>net {net >= 0 ? '+' : ''}{net}/mo</span>
        <span className="m" style={{ fontSize: 11 }}>{obligations} obligation{obligations === '1' ? '' : 's'}</span>
      </div>
      {risks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {risks.map((r, i) => (
            <div key={i} style={{ fontSize: 10.5, display: 'flex', gap: 6 }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--err)', alignSelf: 'center', flexShrink: 0 }} />
              <span style={{ color: 'var(--err)' }}>{r.label} — <span className="m">{r.detail}</span></span>
            </div>
          ))}
        </div>
      )}
      {due.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {due.map((d, i) => (
            <div key={i} style={{ fontSize: 10.5, display: 'flex', gap: 6 }} className="m">
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--warn)', alignSelf: 'center', flexShrink: 0 }} />
              <span>{d.label} — {d.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
