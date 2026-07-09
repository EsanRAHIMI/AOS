'use client';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.2 — Learning & Growth domain visual.
 *
 * `zone.items` detail strings are `"→ {targetSkill}"` or empty
 * (shared/src/personal). Renders each active learning track as a lane
 * running toward its target skill. `PersonalLearningTrack` has no
 * percent-complete field, so this deliberately does not draw a progress
 * bar or invent a percentage — only what's real: the track exists, and
 * (if given) what it's aimed at.
 */
export function SkillLanes({ zone }: { zone: ZoneData }) {
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>No learning tracks active.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 0' }}>
      {zone.items.map((it, i) => {
        const target = it.detail.replace(/^→\s*/, '').trim();
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} className="op-active-dot" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
              {target && (
                <>
                  <span className="m" style={{ fontSize: 11 }}>→</span>
                  <span className="chip" style={{ fontSize: 10 }}>{target}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
