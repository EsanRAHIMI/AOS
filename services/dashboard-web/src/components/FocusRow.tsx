'use client';
import { summonJarvis } from './UniverseZone';
import type { FocusItem } from '@/lib/focus';

/**
 * Phase AF.1 Step 3 — Focus Row / Today Command Layer.
 *
 * The top 1–3 things that actually need attention right now, built by the
 * pure `buildFocusItems()` in `src/lib/focus.ts` — never a generic card
 * grid. Each item is visually weighted and labeled by kind so a user-stated
 * priority is never confused with a routine system warning.
 */

const KIND_META: Record<FocusItem['kind'], { label: string; color: string; badge: 'ok' | 'warn' | 'err' }> = {
  priority: { label: 'YOUR PRIORITY', color: 'var(--accent)', badge: 'ok' },
  blocker: { label: 'BLOCKER', color: 'var(--err)', badge: 'err' },
  approval: { label: 'APPROVAL', color: 'var(--warn)', badge: 'warn' },
  recommendation: { label: 'RECOMMENDED', color: 'var(--accent-2)', badge: 'ok' },
  warning: { label: 'SYSTEM', color: 'var(--border-2)', badge: 'warn' },
};

export function FocusRow({ items }: { items: FocusItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, minmax(220px, 1fr))`,
        gap: 12,
        marginBottom: 14,
      }}
    >
      {items.map((item, i) => {
        const meta = KIND_META[item.kind];
        const isPrimary = item.kind === 'priority';
        return (
          <div
            key={i}
            className="card"
            style={{
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: `2px solid ${meta.color}`,
              background: isPrimary ? 'var(--glass-2)' : undefined,
            }}
          >
            <span className={`badge ${meta.badge}`} style={{ alignSelf: 'flex-start', fontSize: 10 }}>{meta.label}</span>
            <div style={{ fontSize: isPrimary ? 15.5 : 13, fontWeight: isPrimary ? 700 : 600, lineHeight: 1.4 }}>{item.detail}</div>
            <button
              type="button"
              className="chip"
              style={{ cursor: 'pointer', fontSize: 10.5, alignSelf: 'flex-start', marginTop: 'auto' }}
              onClick={() => summonJarvis(item.jarvisCommand)}
            >◈ Ask Jarvis</button>
          </div>
        );
      })}
    </div>
  );
}
