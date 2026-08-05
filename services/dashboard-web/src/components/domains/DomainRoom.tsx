import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader, MetricCard, EmptyState } from '@/components/ui';
import { actionsFor } from '@/lib/domainActions';
import { DomainActionControl } from './DomainActionControl';
import { JarvisOpenButton } from './JarvisOpenButton';
import type { DeeperLink } from '@/lib/domainRoomLinks';
import type { ZoneData } from '../UniverseZone';

/**
 * Phase AF.5 — the one comparable template every dedicated domain room uses.
 * Closes the "Command Universe follow-through" gap: previously a zone's
 * "Open" link led to a generic or mismatched page (see
 * docs/living-command-universe-vision.md Section A.4); now every zone has a
 * real room built from this exact same structure, so the nine domains read
 * as one coherent system instead of nine ad hoc pages of varying depth.
 *
 * Structure (identical for all nine):
 *  1. Header — real title/subtitle/breadcrumb from the zone's own data, plus
 *     an "Ask Jarvis" action seeded with the zone's real jarvisCommand.
 *  2. Metrics row — the zone's own real metrics (not recomputed here).
 *  3. Overview — the zone's existing homepage visual, reused at full width
 *     (visual continuity with the Command Universe home) plus the zone's
 *     real domain actions.
 *  4. Go deeper — links to whichever pre-existing richer page already
 *     manages this domain's data (may be empty; never a fabricated link).
 *  5. Full record — the COMPLETE, unsliced list for this domain (not the
 *     3-6 item homepage summary) via `/v1/me/universe/detail`.
 */
export interface DomainRoomItem { label: string; detail: string; tone: 'ok' | 'warn' | 'err' | 'neutral'; timestamp?: string | null; href?: string }

export function DomainRoom({
  zone, visual, items, itemsLabel, deeperLinks, itemsEmptyHint,
}: {
  zone: ZoneData;
  visual: ReactNode;
  items: DomainRoomItem[];
  itemsLabel: string;
  deeperLinks: DeeperLink[];
  itemsEmptyHint?: string;
}) {
  const toneBadge = (t: string): string => (t === 'neutral' ? '' : t);
  return (
    <>
      <PageHeader
        title={zone.title}
        subtitle={zone.headline}
        crumbs={[['/', 'Command Universe'], [zone.href, zone.title]]}
        actions={<JarvisOpenButton command={zone.jarvisCommand} />}
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {zone.metrics.map((m, i) => (
          <MetricCard key={i} label={m.label} value={m.value} tone={m.tone === 'ok' || m.tone === 'warn' || m.tone === 'err' ? m.tone : undefined} />
        ))}
      </div>

      <div className="grid cols-2" style={{ gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Overview</div>
          {visual}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {actionsFor(zone.zoneId).map((a) => <DomainActionControl key={a.id} action={a} />)}
          </div>
        </div>
        <div className="card">
          <div className="label" style={{ marginBottom: 10 }}>Go deeper</div>
          {deeperLinks.length === 0 ? (
            <EmptyState icon="·" title="No dedicated management page yet" hint="This room already shows the complete record set below — a richer editing page will be added if this domain's data grows complex enough to need one." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deeperLinks.map((l) => (
                <Link key={l.href} href={l.href} className="glass" style={{ padding: 10, textDecoration: 'none', display: 'block', color: 'inherit' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{l.label} →</div>
                  <div className="m" style={{ fontSize: 11.5 }}>{l.description}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="label" style={{ marginBottom: 10 }}>{itemsLabel} ({items.length})</div>
        {items.length === 0 ? (
          <EmptyState icon="·" title="No records yet" hint={itemsEmptyHint ?? zone.setupHint} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((it, i) => {
              const row = (
                <div className="glass" style={{ padding: 9, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div>{it.label}</div>
                    {it.detail && <div className="m" style={{ fontSize: 11 }}>{it.detail}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {it.timestamp && <span className="m" style={{ fontSize: 10.5 }}>{it.timestamp.slice(0, 10)}</span>}
                    <span className={`badge ${toneBadge(it.tone)}`}>{it.tone}</span>
                  </div>
                </div>
              );
              return it.href ? <Link key={i} href={it.href} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link> : <div key={i}>{row}</div>;
            })}
          </div>
        )}
      </div>
    </>
  );
}
