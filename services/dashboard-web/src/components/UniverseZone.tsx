'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { buildDomainInsight } from '@/lib/domainInsight';

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

/** Phase AF.2 — domain-specific inline Jarvis annotation, replacing the old
 *  single generic message. `buildDomainInsight()` (src/lib/domainInsight.ts)
 *  branches per zone to say why the domain matters and what's concretely
 *  missing or wrong, built only from the zone's own real fields. This is
 *  now the ONE place a card explains itself — it supersedes the old
 *  separate dashed setup-hint box below (kept only as a defensive fallback
 *  if a future zone type has no insight branch yet, so nothing ever goes
 *  silently unexplained). A 'live' zone gets nothing: no insight, no box —
 *  silence is correct when there's nothing to flag. */
function JarvisAnnotation({ zone }: { zone: ZoneData }) {
  const insight = buildDomainInsight(zone);
  if (!insight) return null;
  const borderColor = insight.kind === 'blocker' ? 'var(--err)' : insight.kind === 'opportunity' ? 'var(--ok)' : 'var(--accent, var(--border-2))';
  const icon = insight.kind === 'blocker' ? '⚠' : insight.kind === 'opportunity' ? '↗' : '◈';
  return (
    <div
      style={{
        fontSize: 11, lineHeight: 1.5, padding: '6px 9px', borderRadius: 6,
        borderLeft: `2px solid ${borderColor}`, background: 'var(--glass-2)', display: 'flex', gap: 6,
      }}
    >
      <span style={{ flexShrink: 0, opacity: 0.8 }}>{icon}</span>
      <span className="m" style={{ color: 'var(--text)' }}>{insight.text}</span>
    </div>
  );
}

export function UniverseZone({ zone, children, tall }: { zone: ZoneData; children?: ReactNode; tall?: boolean }) {
  const meta = STATUS_META[zone.status] ?? STATUS_META.setup_needed;
  const toneColor = (t: string): string => (t === 'ok' ? 'var(--ok)' : t === 'warn' ? 'var(--warn)' : t === 'err' ? 'var(--err)' : 'var(--muted, #7a8699)');
  const insight = buildDomainInsight(zone);

  // Phase AF.2 Step 5 — screen-guidance: this card is a real navigation
  // target (`#zone-<id>`) so a Jarvis reply can point straight at it. Purely
  // client-side visual affordance — a hash + a temporary highlight/scroll,
  // nothing that touches approval, scope, or memory logic.
  const anchorId = `zone-${zone.zoneId}`;
  const [highlighted, setHighlighted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const checkHash = () => {
      if (window.location.hash !== `#${anchorId}`) return;
      setHighlighted(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setHighlighted(false), 2600);
    };
    checkHash(); // initial mount (fresh navigation to a hash URL)
    // Also listen for hashchange: a domain-link click while already on this
    // page updates the hash without a remount, so the mount check alone
    // would miss it.
    window.addEventListener('hashchange', checkHash);
    return () => {
      window.removeEventListener('hashchange', checkHash);
      clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      id={anchorId}
      ref={ref}
      className="card uz-card"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, gridRow: tall ? 'span 2' : undefined,
        borderTop: `2px solid ${meta?.color}`,
        boxShadow: highlighted ? '0 0 0 2px var(--accent), 0 0 24px var(--accent)' : undefined,
        transition: 'box-shadow 0.4s ease',
        scrollMarginTop: 90,
      }}
    >
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
      <JarvisAnnotation zone={zone} />
      {/* Generic bullet list of raw items — only shown when there is no
          domain-specific visual (`children`) already representing this
          zone's items. A custom renderer replaces this entirely instead of
          sitting above/below a duplicate of the same data. */}
      {!children && zone.items.length > 0 && (
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
      {/* Defensive fallback only — buildDomainInsight() covers every real
          zoneId, so this should never actually render; it exists so a
          future zone type without an insight branch still explains itself
          instead of going silently unexplained. */}
      {!insight && (zone.status === 'setup_needed' || zone.status === 'not_configured') && (
        <div className="m" style={{ fontSize: 10.5, lineHeight: 1.5, padding: '6px 8px', borderRadius: 6, border: '1px dashed var(--border)', background: 'var(--glass-2)' }}>{zone.setupHint}</div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" className="chip" style={{ cursor: 'pointer', fontSize: 10.5 }} onClick={() => summonJarvis(zone.jarvisCommand)} title={`Ask Jarvis: “${zone.jarvisCommand}”`}>◈ Jarvis</button>
        <Link href={zone.href} className="chip" style={{ fontSize: 10.5, textDecoration: 'none' }}>Open</Link>
      </div>
    </div>
  );
}
