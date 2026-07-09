'use client';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.1 Step 4 — Presence / Channels domain visual.
 *
 * Connector states as badges, not prose bullets. This zone's honest
 * `not_configured` behavior was already correct (Phase AC+) — this only
 * changes how it looks, not what it claims. Prepares the visual slot for
 * calendar/email/social connectors as they land.
 */

const TONE_BADGE: Record<string, 'ok' | 'warn' | 'err'> = { ok: 'ok', warn: 'warn', err: 'err', neutral: 'warn' };

export function PresenceBadges({ zone }: { zone: ZoneData }) {
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>No channels connected yet.</div>;
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0' }}>
      {zone.items.map((it, i) => (
        <span key={i} className={`badge ${TONE_BADGE[it.tone] ?? 'warn'}`} style={{ fontSize: 10.5, textTransform: 'capitalize' }}>
          {it.label} · {it.detail}
        </span>
      ))}
    </div>
  );
}
