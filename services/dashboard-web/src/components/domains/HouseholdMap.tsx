'use client';
import type { ZoneData } from '../UniverseZone';
import { firstSegment, segments } from '@/lib/zoneParsing';

/**
 * Phase AF.2 — Family & Home domain visual.
 *
 * `zone.items` detail strings are `"{domain} · {itemType}[ · due {date}]"`
 * (family|home|relationship|household, per shared/src/personal). Groups
 * items by that real domain tag into clustered chip groups instead of one
 * flat list, and separately calls out due dates and high-importance
 * (`tone: 'warn'`) items — the two things actually worth a glance.
 */
export function HouseholdMap({ zone }: { zone: ZoneData }) {
  if (zone.items.length === 0) {
    return <div className="m" style={{ fontSize: 11, padding: '2px 0' }}>Personal world not mapped yet.</div>;
  }

  const groups = new Map<string, typeof zone.items>();
  for (const it of zone.items) {
    const domain = firstSegment(it.detail) || 'other';
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(it);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
      {[...groups.entries()].map(([domain, items]) => (
        <div key={domain} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="label" style={{ fontSize: 9.5, textTransform: 'capitalize' }}>{domain} · {items.length}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {items.map((it, i) => {
              const parts = segments(it.detail);
              const due = parts.find((p) => p.startsWith('due '));
              const high = it.tone === 'warn';
              return (
                <span
                  key={i}
                  className="chip"
                  style={{
                    fontSize: 10.5,
                    borderColor: high ? 'var(--warn)' : undefined,
                    color: high ? 'var(--warn)' : undefined,
                  }}
                  title={it.detail}
                >
                  {high && '● '}{it.label}{due ? ` · ${due}` : ''}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
