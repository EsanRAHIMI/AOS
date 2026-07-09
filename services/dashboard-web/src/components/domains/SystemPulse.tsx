'use client';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.1 Step 4 — Systems / AI Kernel domain visual.
 *
 * Deliberately compact: a single-row infrastructure pulse, not a dashboard
 * of its own. The product direction is explicit — systems stay visible but
 * must never dominate the universe (docs/living-command-universe-vision.md
 * §D). Built entirely from the `systems` zone's real metrics/items plus the
 * safe-mode flag already fetched on the homepage — no new endpoint.
 */

export function SystemPulse({ zone, safeMode }: { zone: ZoneData; safeMode: boolean }) {
  const services = zone.metrics.find((m) => m.label === 'services')?.value ?? '0';
  const incidents = zone.metrics.find((m) => m.label === 'incidents');
  const incidentCount = Number(incidents?.value ?? '0');
  const activeOp = zone.items.find((it) => it.label === 'Active operation');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '2px 0' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: incidentCount ? 'var(--err)' : 'var(--ok)' }} className={incidentCount ? 'op-active-dot' : undefined} />
        <span className="m" style={{ fontSize: 11 }}>{services} service{services === '1' ? '' : 's'}</span>
      </span>
      <span className="badge" style={{ fontSize: 10 }}>
        <span className={incidentCount ? undefined : undefined} style={{ color: incidentCount ? 'var(--err)' : 'var(--ok)' }}>{incidentCount}</span>
        &nbsp;incident{incidentCount === 1 ? '' : 's'}
      </span>
      <span className={`badge ${safeMode ? 'warn' : 'ok'}`} style={{ fontSize: 10 }}>safe mode {safeMode ? 'ON' : 'off'}</span>
      {activeOp && <span className="chip" style={{ fontSize: 10 }} title={activeOp.detail}>▸ operation active</span>}
    </div>
  );
}
