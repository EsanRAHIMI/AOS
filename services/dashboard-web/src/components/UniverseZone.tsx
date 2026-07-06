'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Phase AC+ — one zone of the Command Universe. Client component so every
 *  zone can summon Jarvis with its own contextual command via the event
 *  bridge (`aos:jarvis`), which the Operator Console listens to. */

export interface ZoneData {
  zoneId: string;
  title: string;
  status: string;
  headline: string;
  items: Array<{ label: string; detail: string; tone: string; href?: string }>;
  setupHint: string;
  jarvisCommand: string;
  href: string;
  metrics: Array<{ label: string; value: string; tone: string }>;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  live: { label: 'LIVE', color: 'var(--ok)' },
  attention: { label: 'ATTENTION', color: 'var(--err)' },
  setup_needed: { label: 'AWAITING DATA', color: 'var(--warn)' },
  not_configured: { label: 'NOT CONNECTED', color: 'var(--border-2)' },
};

export function summonJarvis(command: string): void {
  window.dispatchEvent(new CustomEvent('aos:jarvis', { detail: { command } }));
}

export function UniverseZone({ zone, children, tall }: { zone: ZoneData; children?: ReactNode; tall?: boolean }) {
  const meta = STATUS_META[zone.status] ?? STATUS_META.setup_needed;
  const toneColor = (t: string): string => (t === 'ok' ? 'var(--ok)' : t === 'warn' ? 'var(--warn)' : t === 'err' ? 'var(--err)' : 'var(--muted, #7a8699)');
  return (
    <div className="card uz-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, gridRow: tall ? 'span 2' : undefined, borderTop: `2px solid ${meta?.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Link href={zone.href} style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '0.03em', textDecoration: 'none' }}>{zone.title}</Link>
        <span style={{ fontSize: 9, letterSpacing: '0.12em', fontWeight: 700, color: meta?.color }} className={zone.status === 'live' || zone.status === 'attention' ? 'op-active-dot' : undefined}>{meta?.label}</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {zone.metrics.map((m, i) => (
          <span key={i} style={{ fontSize: 11 }} className="m"><b style={{ color: toneColor(m.tone), fontSize: 14 }}>{m.value}</b> {m.label}</span>
        ))}
      </div>
      {children}
      <div style={{ fontSize: 12, lineHeight: 1.45 }}>{zone.headline}</div>
      {zone.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {zone.items.slice(0, 5).map((it, i) => {
            const row = (
              <div style={{ display: 'flex', gap: 6, fontSize: 11.5, alignItems: 'baseline' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: toneColor(it.tone), flexShrink: 0, position: 'relative', top: -1 }} />
                <span style={{ minWidth: 0 }}>{it.label}{it.detail && <span className="m"> — {it.detail}</span>}</span>
              </div>
            );
            return it.href ? <Link key={i} href={it.href} style={{ textDecoration: 'none' }}>{row}</Link> : <div key={i}>{row}</div>;
          })}
        </div>
      )}
      {(zone.status === 'setup_needed' || zone.status === 'not_configured') && (
        <div className="m" style={{ fontSize: 10.5, lineHeight: 1.5, padding: '6px 8px', borderRadius: 6, border: '1px dashed var(--border)', background: 'var(--glass-2)' }}>{zone.setupHint}</div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10.5 }} onClick={() => summonJarvis(zone.jarvisCommand)} title={`Ask Jarvis: “${zone.jarvisCommand}”`}>◈ Jarvis</button>
        <Link href={zone.href} className="chip" style={{ fontSize: 10.5, textDecoration: 'none' }}>Open</Link>
      </div>
    </div>
  );
}
