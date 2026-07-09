'use client';
/** Phase AH.2 — the anatomical scan layer of the Health intelligence surface.
 *
 *  Controlled SVG component: all state (hover) lives in HealthIntelligence.
 *  Renders the refined silhouette (skull/jaw head, clavicles, sternum,
 *  ribcage arcs, spine axis, pelvic girdle, joint nodes), one on-body anchor
 *  per ACTIVE anatomical region, and two metric chip rails whose chips are
 *  severity-retained (worst kept first when space runs out) but always
 *  displayed in anatomical top-to-bottom order so leader lines never cross.
 *
 *  Systemic layers (sleep, stress, activity, composition, vitality, general)
 *  are deliberately NOT drawn on the body — they render in the layer strip
 *  owned by HealthIntelligence. The recovery orbit ring around the head is
 *  the one visual echo of a systemic layer, brightened when sleep data
 *  exists.
 *
 *  Everything here is static geometry + real data: no random ids, no
 *  timestamps, no invented values → no hydration risk.
 */
import type { ReactElement } from 'react';
import {
  REGION_IDS, SEVERITY_COLOR, capitalize, domainChipText, formatMetricValue,
  type DomainId, type HealthModel, type RegionId,
} from '@/lib/bodyZones';

/* ── static geometry (base coords; body group translated +50,+6) ──── */

const SILHOUETTE_D = `M 112 54
C 112 60 111 64 108 67 C 98 71 88 73 83 79 C 76 87 74 96 72 108
C 70 122 69 130 67 144 C 65 156 63 166 62 176 C 61 183 60 190 61 196
C 62 202 66 204 68 200 C 70 195 71 188 72 180 C 74 170 76 160 78 148
C 80 136 82 124 85 112 C 87 105 89 101 90 98 C 92 108 93 118 93 126
C 93 138 95 146 97 152 C 95 162 92 172 92 182 C 91 194 93 204 96 214
C 99 228 100 240 101 252 C 101 262 100 270 101 282 C 102 296 103 308 104 318
C 104 326 101 330 97 332 C 99 337 108 338 113 334 C 114 331 114 326 114 320
C 115 306 114 292 113 278 C 112 264 112 256 113 248 C 114 234 116 222 118 212
C 119 208 120 206 120 204 C 120 206 121 208 122 212 C 124 222 126 234 127 248
C 128 256 128 264 127 278 C 126 292 125 306 126 320 C 126 326 126 330 127 334
C 132 338 141 337 143 332 C 139 330 136 326 136 318 C 137 308 138 296 139 282
C 140 270 139 262 139 252 C 140 240 141 228 144 214 C 147 204 149 194 148 182
C 148 172 145 162 143 152 C 145 146 147 138 147 126 C 147 118 148 108 150 98
C 151 101 153 105 155 112 C 158 124 160 136 162 148 C 164 160 166 170 168 180
C 169 188 170 195 172 200 C 174 204 178 202 179 196 C 180 190 179 183 178 176
C 177 166 175 156 173 144 C 171 130 170 122 168 108 C 166 96 164 87 157 79
C 152 73 142 71 132 67 C 129 64 128 60 128 54 Z`;

/** Skull with subtle temple taper and jaw — replaces the old plain ellipse. */
const SKULL_D = `M 105 34 C 105 20 111 13 120 13 C 129 13 135 20 135 34
C 135 42 131 49 126 52.5 C 123 54.5 117 54.5 114 52.5 C 109 49 105 42 105 34 Z`;

interface RegionGeom {
  anchor: { x: number; y: number };
  side: 'left' | 'right';
  /** Short display name for rail chips (full label lives in DOMAIN_LABELS). */
  short: string;
  /** Hover hotspot radius around the anchor. */
  hit: number;
}

const REGION_GEOM: Record<RegionId, RegionGeom> = {
  hair: { anchor: { x: 120, y: 15 }, side: 'right', short: 'Hair', hit: 6 },
  head: { anchor: { x: 120, y: 27 }, side: 'left', short: 'Mind', hit: 9 },
  eyes: { anchor: { x: 126, y: 34 }, side: 'right', short: 'Eyes', hit: 5 },
  ears: { anchor: { x: 105, y: 37 }, side: 'left', short: 'Ears', hit: 5 },
  mouth: { anchor: { x: 120, y: 48 }, side: 'right', short: 'Dental', hit: 5 },
  neck: { anchor: { x: 120, y: 62 }, side: 'left', short: 'Neck', hit: 7 },
  chest: { anchor: { x: 120, y: 96 }, side: 'right', short: 'Heart', hit: 24 },
  abdomen: { anchor: { x: 120, y: 142 }, side: 'left', short: 'Digestion', hit: 18 },
  gut: { anchor: { x: 110, y: 126 }, side: 'right', short: 'Gut', hit: 8 },
  spine: { anchor: { x: 120, y: 176 }, side: 'left', short: 'Spine', hit: 9 },
  arms: { anchor: { x: 66, y: 150 }, side: 'left', short: 'Arms', hit: 12 },
  hips: { anchor: { x: 120, y: 192 }, side: 'right', short: 'Hips', hit: 12 },
  legs: { anchor: { x: 101, y: 258 }, side: 'left', short: 'Legs', hit: 14 },
  feet: { anchor: { x: 105, y: 330 }, side: 'right', short: 'Feet', hit: 10 },
};

const TX = 50; // body group x-translate inside the 340-wide viewBox
const TY = 6;
const RAIL_RIGHT_X = 252;
const RAIL_LEFT_EDGE = 88; // right edge of the left rail
const CHIP_H = 16;
const CHIP_GAP = 18;
const CHIP_MAX_W = 84;
const CHAR_W = 4.3;

const chipWidth = (text: string): number => Math.min(Math.round(text.length * CHAR_W + 16), CHIP_MAX_W);
const fitText = (text: string): string => {
  const maxChars = Math.floor((CHIP_MAX_W - 16) / CHAR_W);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
};

/* ── component ────────────────────────────────────────────────────── */

export function BodyScan({
  model, hovered, onHover, maxChipsPerRail,
}: {
  model: HealthModel;
  hovered: DomainId | null;
  onHover: (d: DomainId | null) => void;
  maxChipsPerRail: number;
}) {
  const active = REGION_IDS.filter((id) => model.domains[id].active);

  /** Rail chips: retain worst-severity regions when space runs out, then
   *  lay out in anatomical (anchor-y) order so leader lines never cross. */
  const railChips = (side: 'left' | 'right') => {
    const onSide = active.filter((id) => REGION_GEOM[id].side === side);
    const retained = model.activeDomains
      .filter((d) => !d.systemic && onSide.includes(d.domain as RegionId))
      .slice(0, maxChipsPerRail)
      .map((d) => d.domain as RegionId);
    const overflow = onSide.length - retained.length;
    const ordered = retained.sort((a, b) => REGION_GEOM[a].anchor.y - REGION_GEOM[b].anchor.y);

    let prevY = -Infinity;
    const rows = ordered.map((id) => {
      const g = REGION_GEOM[id];
      const y = Math.max(g.anchor.y + TY, prevY + CHIP_GAP);
      prevY = y;
      return { id, y };
    });

    return (
      <g data-rail={side}>
        {rows.map(({ id, y }) => {
          const g = REGION_GEOM[id];
          const state = model.domains[id];
          const color = SEVERITY_COLOR[state.severity];
          const text = fitText(`${g.short} ${domainChipText(state)}`);
          const w = chipWidth(text);
          const chipX = side === 'right' ? RAIL_RIGHT_X : RAIL_LEFT_EDGE - w;
          const leaderFromX = g.anchor.x + TX + (side === 'right' ? 7 : -7);
          const leaderToX = side === 'right' ? RAIL_RIGHT_X - 3 : RAIL_LEFT_EDGE + 3;
          const isHover = hovered === id;
          return (
            <g
              key={id}
              className="bm-hotspot"
              data-domain-chip={id}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
            >
              <path d={`M ${leaderFromX} ${g.anchor.y + TY} L ${leaderToX} ${y}`} stroke={color} strokeWidth={0.5} opacity={isHover ? 0.7 : 0.3} fill="none" />
              <rect x={chipX} y={y - CHIP_H / 2} width={w} height={CHIP_H} rx={CHIP_H / 2} fill="var(--glass-2, rgba(255,255,255,0.05))" stroke={color} strokeOpacity={isHover ? 0.9 : 0.45} strokeWidth={0.6} />
              <circle cx={chipX + 8} cy={y} r={2} fill={color} className={state.concern ? 'bm-pulse' : undefined} />
              <text x={chipX + 14} y={y + 2.5} fontSize={7} fill="var(--text, #c6cede)" style={{ letterSpacing: '0.02em' }}>
                {text}
              </text>
              <title>{`${state.label}: ${state.metrics.map((m) => `${capitalize(m.metric)} ${formatMetricValue(m)}`).join(' · ')}`}</title>
            </g>
          );
        })}
        {overflow > 0 && (
          <text
            x={side === 'right' ? RAIL_RIGHT_X + 4 : RAIL_LEFT_EDGE - 4}
            y={prevY + CHIP_GAP}
            fontSize={6.5} fill="var(--muted-2, #6c7596)"
            textAnchor={side === 'right' ? 'start' : 'end'}
          >
            +{overflow} more
          </text>
        )}
      </g>
    );
  };

  /** On-body anchor for one region (dormant regions get a faint point). */
  const regionAnchor = (id: RegionId): ReactElement => {
    const g = REGION_GEOM[id];
    const state = model.domains[id];
    const color = SEVERITY_COLOR[state.severity];
    const isHover = hovered === id;
    return (
      <g key={id} data-zone={id} aria-label={`${state.label} region`}>
        {isHover && <circle cx={g.anchor.x} cy={g.anchor.y} r={Math.max(g.hit, 10)} fill={state.active ? color : 'var(--accent)'} opacity={0.12} />}
        {state.concern && <circle className="bm-pulse" cx={g.anchor.x} cy={g.anchor.y} r={8} fill="none" stroke={SEVERITY_COLOR[state.severity]} strokeWidth={1} />}
        {state.active ? (
          <>
            <circle cx={g.anchor.x} cy={g.anchor.y} r={5} fill={color} opacity={0.16} />
            <circle className="bm-breathe" cx={g.anchor.x} cy={g.anchor.y} r={2.2} fill={color} filter="url(#bmGlow)" />
          </>
        ) : (
          <circle cx={g.anchor.x} cy={g.anchor.y} r={1.2} fill="var(--border-2)" opacity={0.5} />
        )}
      </g>
    );
  };

  /** Invisible hover hotspot per region. */
  const hotspot = (id: RegionId): ReactElement => {
    const g = REGION_GEOM[id];
    const state = model.domains[id];
    return (
      <circle
        key={id}
        className="bm-hotspot"
        data-zone-hotspot={id}
        role="img"
        aria-label={state.active ? `${state.label}: ${state.metrics.length} signal${state.metrics.length === 1 ? '' : 's'}` : `${state.label}: no reports yet`}
        cx={g.anchor.x} cy={g.anchor.y} r={g.hit}
        fill="transparent" stroke="none"
        onMouseEnter={() => onHover(id)}
        onMouseLeave={() => onHover(null)}
      />
    );
  };

  return (
    <svg
      viewBox="0 0 340 392"
      role="img"
      aria-label="Body intelligence scan"
      style={{ width: '100%', maxWidth: 420, height: 'auto', display: 'block', margin: '0 auto' }}
    >
      <defs>
        <linearGradient id="bmFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} stopOpacity={0.14} />
          <stop offset="0.55" style={{ stopColor: 'var(--ok)' }} stopOpacity={0.06} />
          <stop offset="1" style={{ stopColor: 'var(--accent)' }} stopOpacity={0.03} />
        </linearGradient>
        <filter id="bmGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <g transform={`translate(${TX},${TY})`}>
        {/* biometric rings */}
        <circle cx="120" cy="176" r="96" fill="none" stroke="var(--accent)" strokeWidth="0.5" opacity="0.14" strokeDasharray="1 6" />
        <circle cx="120" cy="176" r="118" fill="none" stroke="var(--accent-2, var(--accent))" strokeWidth="0.4" opacity="0.09" strokeDasharray="1 9" />
        {/* recovery orbit — brightens when sleep/rest data exists */}
        <circle cx="120" cy="38" r="27" fill="none" stroke="var(--ok)" strokeWidth="0.6" strokeDasharray="2 4" opacity={model.domains.recovery.active ? 0.45 : 0.15} />

        {/* anatomy */}
        <g data-body-silhouette="true">
          <path d={SKULL_D} fill="url(#bmFill)" stroke="var(--accent)" strokeWidth="1.1" opacity="0.92" filter="url(#bmGlow)" />
          {/* ears */}
          <path d="M 104.5 33 C 102.5 33 102 36 104 38.5" fill="none" stroke="var(--accent)" strokeWidth="0.8" opacity="0.55" />
          <path d="M 135.5 33 C 137.5 33 138 36 136 38.5" fill="none" stroke="var(--accent)" strokeWidth="0.8" opacity="0.55" />
          <path d={SILHOUETTE_D} fill="url(#bmFill)" stroke="var(--accent)" strokeWidth="1.1" opacity="0.92" filter="url(#bmGlow)" />
          {/* skeletal segmentation — clavicles, sternum, ribcage, spine, pelvis */}
          <path d="M 120 73 C 112 70 102 71 95 76 M 120 73 C 128 70 138 71 145 76" fill="none" stroke="var(--accent)" strokeWidth="0.7" opacity="0.32" />
          <path d="M 120 74 L 120 96" stroke="var(--accent)" strokeWidth="0.7" opacity="0.28" />
          <path d="M 120 96 C 111 97 103 101 99 106 M 120 96 C 129 97 137 101 141 106" fill="none" stroke="var(--accent)" strokeWidth="0.55" opacity="0.2" />
          <path d="M 120 104 C 112 105 105 109 101 114 M 120 104 C 128 105 135 109 139 114" fill="none" stroke="var(--accent)" strokeWidth="0.55" opacity="0.16" />
          <path d="M 120 112 C 113 113 107 116 104 120 M 120 112 C 127 113 133 116 136 120" fill="none" stroke="var(--accent)" strokeWidth="0.55" opacity="0.12" />
          <path d="M 120 60 L 120 198" stroke="var(--accent)" strokeWidth="0.9" strokeDasharray="1 4" strokeLinecap="round" opacity="0.28" />
          <path d="M 100 182 C 106 192 114 198 120 200 C 126 198 134 192 140 182" fill="none" stroke="var(--accent)" strokeWidth="0.7" opacity="0.22" />
          {/* joint nodes: shoulders, elbows, wrists, knees, ankles */}
          <g fill="var(--accent)" opacity="0.45">
            <circle cx="88" cy="84" r="1.6" /><circle cx="152" cy="84" r="1.6" />
            <circle cx="74" cy="132" r="1.6" /><circle cx="166" cy="132" r="1.6" />
            <circle cx="66" cy="176" r="1.6" /><circle cx="174" cy="176" r="1.6" />
            <circle cx="103" cy="252" r="1.6" /><circle cx="137" cy="252" r="1.6" />
            <circle cx="106" cy="316" r="1.6" /><circle cx="134" cy="316" r="1.6" />
          </g>
        </g>

        {/* hotspots below anchors so markers stay visually crisp */}
        {REGION_IDS.map((id) => hotspot(id))}
        {REGION_IDS.map((id) => regionAnchor(id))}
      </g>

      {/* metric chip rails */}
      {railChips('left')}
      {railChips('right')}
    </svg>
  );
}
