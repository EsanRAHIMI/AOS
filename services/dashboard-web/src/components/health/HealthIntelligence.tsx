'use client';
/** Phase AH.2 — the Health intelligence surface.
 *
 *  Layered module, not a body picture:
 *   1. Status summary — real derived numbers (signals / domains / avg / concerns).
 *   2. BodyScan — anatomical regions with severity-graded rail chips.
 *   3. Systemic layer strip — sleep, stress, activity, composition,
 *      vitality, general: cross-body intelligence that must never be faked
 *      as an organ dot.
 *   4. Hover detail line — fixed-height so hovering never shifts layout.
 *   5. (full variant only) Domain breakdown — every active domain with its
 *      complete metric list, for the dedicated /health room.
 *
 *  `variant="compact"` (homepage card) stays concise: fewer rail chips,
 *  active layers only, no breakdown. `variant="full"` (/health room) shows
 *  more chips, all layers incl. dormant, and the breakdown grid. Both are
 *  the same component over the same model — one source of truth.
 */
import { useState } from 'react';
import { BodyScan } from './BodyScan';
import {
  LAYER_IDS, SEVERITY_COLOR, buildHealthModel, capitalize, domainChipText, formatMetricValue,
  type BodyMetric, type DomainId, type DomainState,
} from '@/lib/bodyZones';

export function HealthIntelligence({ metrics, variant = 'compact' }: { metrics: BodyMetric[]; variant?: 'compact' | 'full' }) {
  const [hovered, setHovered] = useState<DomainId | null>(null);
  const model = buildHealthModel(metrics);
  const full = variant === 'full';
  const empty = metrics.length === 0;

  const layerStates = LAYER_IDS.map((id) => model.domains[id]).filter((d) => d.active || full);

  const summaryBits = [
    `${model.signalCount} signal${model.signalCount === 1 ? '' : 's'}`,
    `${model.activeDomains.length} domain${model.activeDomains.length === 1 ? '' : 's'}`,
    ...(model.averageLevel !== null ? [`avg ${model.averageLevel}/10`] : []),
    ...(model.concernCount > 0 ? [`${model.concernCount} concern${model.concernCount === 1 ? '' : 's'}`] : []),
  ];

  const hoverDetail = (d: DomainId): string => {
    const s = model.domains[d];
    if (!s.active) return `${s.label} — no reports yet`;
    return `${s.label} · ${s.metrics.map((m) => `${capitalize(m.metric)} ${formatMetricValue(m)}${m.concern ? ' ⚠' : ''}`).join(' · ')}`;
  };

  const layerChip = (s: DomainState) => {
    const color = SEVERITY_COLOR[s.severity];
    const isHover = hovered === s.domain;
    return (
      <button
        key={s.domain}
        type="button"
        data-layer-chip={s.domain}
        onMouseEnter={() => setHovered(s.domain)}
        onMouseLeave={() => setHovered(null)}
        title={hoverDetail(s.domain)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
          borderRadius: 999, fontSize: 10.5, cursor: 'default',
          background: 'var(--glass-2)', color: s.active ? 'var(--text)' : 'var(--muted-2)',
          border: `1px solid ${s.active ? color : 'var(--border)'}`,
          opacity: s.active ? 1 : 0.55,
          boxShadow: isHover && s.active ? `0 0 10px -2px ${color}` : undefined,
          transition: 'box-shadow 0.2s ease',
        }}
      >
        <span
          className={s.concern ? 'bm-pulse' : undefined}
          style={{ width: 6, height: 6, borderRadius: '50%', background: s.active ? color : 'var(--border-2)', flexShrink: 0 }}
        />
        {s.label}
        {s.active && <b style={{ color, fontWeight: 700 }}>{domainChipText(s)}</b>}
      </button>
    );
  };

  return (
    <div data-health-intelligence={variant}>
      {/* 1 — status summary (real derived numbers only) */}
      <div className="m" style={{ fontSize: 10.5, letterSpacing: '0.06em', textAlign: 'center', marginBottom: 4, textTransform: 'uppercase' }}>
        {empty ? 'Body intelligence — standby' : summaryBits.join(' · ')}
      </div>

      {/* 2 — anatomical scan */}
      <BodyScan model={model} hovered={hovered} onHover={setHovered} maxChipsPerRail={full ? 7 : 5} />

      {/* 3 — systemic layer strip */}
      {layerStates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
          {layerStates.map((s) => layerChip(s))}
        </div>
      )}

      {/* 4 — hover detail / empty caption (fixed height: no layout shift) */}
      <div className="m" style={{ fontSize: 11, textAlign: 'center', marginTop: 8, minHeight: 16, letterSpacing: '0.03em' }}>
        {hovered
          ? hoverDetail(hovered)
          : empty
            ? 'Awaiting biometric signals — report a health state to activate the scan.'
            : full ? 'Hover a region or layer for detail.' : null}
      </div>

      {/* 5 — full-variant domain breakdown */}
      {full && !empty && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 12 }} data-domain-breakdown="true">
          {model.activeDomains.map((d) => (
            <div key={d.domain} className="glass" style={{ padding: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span
                  className={d.concern ? 'bm-pulse' : undefined}
                  style={{ width: 7, height: 7, borderRadius: '50%', background: SEVERITY_COLOR[d.severity], flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{d.label}</span>
                <span className="m" style={{ fontSize: 10, marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.severity}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {d.metrics.map((m, i) => (
                  <div key={`${m.metric}-${i}`} className="m" style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span>{capitalize(m.metric)}{m.concern ? ' ⚠' : ''}</span>
                    <b style={{ color: SEVERITY_COLOR[d.severity], flexShrink: 0 }}>{formatMetricValue(m)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
