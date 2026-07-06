/** Phase AC+ — abstract human body visualization for the Health zone.
 *  Pure SVG, no data invented: nodes light up only for metrics that have real
 *  reports; unreported nodes render as dormant setup-ready points. */

export interface BodyMetric { metric: string; level: number | null; concern: boolean; detail: string }

const NODE_POS: Record<string, { x: number; y: number; label: string }> = {
  wellbeing: { x: 60, y: 26, label: 'Wellbeing' },
  stress: { x: 60, y: 44, label: 'Stress' },
  sleep: { x: 38, y: 32, label: 'Sleep' },
  energy: { x: 60, y: 78, label: 'Energy' },
  nutrition: { x: 60, y: 102, label: 'Nutrition' },
  weight: { x: 82, y: 92, label: 'Weight' },
  activity: { x: 40, y: 148, label: 'Activity' },
  habit: { x: 82, y: 32, label: 'Habits' },
  symptom: { x: 38, y: 92, label: 'Symptoms' },
};

export function BodyMap({ metrics }: { metrics: BodyMetric[] }) {
  const byMetric = new Map(metrics.map((m) => [m.metric, m]));
  return (
    <svg viewBox="0 0 120 200" style={{ width: '100%', maxWidth: 150, height: 'auto', display: 'block', margin: '0 auto' }} aria-label="Body state map">
      {/* Abstract figure */}
      <g stroke="var(--border-2)" strokeWidth="1.6" fill="none" opacity="0.9">
        <circle cx="60" cy="26" r="13" />
        <path d="M60 39 L60 110" />
        <path d="M60 52 L34 84" />
        <path d="M60 52 L86 84" />
        <path d="M60 110 L42 160" />
        <path d="M60 110 L78 160" />
      </g>
      {/* Aura ring — subtle life indicator */}
      <circle cx="60" cy="95" r="56" fill="none" stroke="var(--accent)" strokeWidth="0.5" opacity="0.25" strokeDasharray="3 5" />
      {/* Metric nodes */}
      {Object.entries(NODE_POS).map(([metric, pos]) => {
        const m = byMetric.get(metric);
        const active = Boolean(m);
        const color = !active ? 'var(--border-2)' : m?.concern ? 'var(--err)' : (m?.level ?? 10) < 4 ? 'var(--warn)' : 'var(--ok)';
        return (
          <g key={metric}>
            <circle cx={pos.x} cy={pos.y} r={active ? 4 : 2.5} fill={active ? color : 'transparent'} stroke={color} strokeWidth="1.2" opacity={active ? 1 : 0.55}>
              {active && <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" />}
            </circle>
            <title>{`${pos.label}: ${m ? m.detail || `${m.level ?? '—'}/10` : 'no report yet — ingest kind=health_state'}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
