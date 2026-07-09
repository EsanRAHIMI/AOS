/** Phase AH.2 — Health Domain Model (pure, JSX-free).
 *
 *  The data spine of the Body & Health intelligence surface. Two kinds of
 *  health domain:
 *
 *   - ANATOMICAL REGIONS — attach to a physical location on the body scan
 *     (head, eyes, chest, spine, …). Rendered as on-body anchors with
 *     rail chips.
 *   - SYSTEMIC LAYERS — cross-body intelligence that has no single organ
 *     (sleep/recovery, stress/nervous system, activity, body composition,
 *     hormones/vitality, and a general whole-body layer). Rendered as a
 *     layer strip, never as a fake body dot.
 *
 *  Every reported metric maps to exactly one domain via an exact table plus
 *  keyword fallback; unknown metrics land in the `general` layer so nothing
 *  is ever dropped or invented. Severity is graded (critical / attention /
 *  moderate / optimal / noted), not binary.
 *
 *  Kept JSX-free so the Phase AH.2 smoke compiles and exercises the real
 *  mapping/severity/model logic standalone (same pattern as domainCanvas).
 */

export interface BodyMetric {
  metric: string;
  level: number | null;
  concern: boolean;
  detail: string;
}

/* ── domain registry ──────────────────────────────────────────────── */

export type RegionId =
  | 'hair' | 'head' | 'eyes' | 'ears' | 'mouth' | 'neck'
  | 'chest' | 'abdomen' | 'gut' | 'spine' | 'arms' | 'hips' | 'legs' | 'feet';

export type LayerId = 'recovery' | 'nervous' | 'activity' | 'composition' | 'vitality' | 'general';

export type DomainId = RegionId | LayerId;

export const REGION_IDS: readonly RegionId[] = [
  'hair', 'head', 'eyes', 'ears', 'mouth', 'neck',
  'chest', 'abdomen', 'gut', 'spine', 'arms', 'hips', 'legs', 'feet',
] as const;

export const LAYER_IDS: readonly LayerId[] = [
  'recovery', 'nervous', 'activity', 'composition', 'vitality', 'general',
] as const;

export const DOMAIN_LABELS: Record<DomainId, string> = {
  hair: 'Hair & Scalp',
  head: 'Mind',
  eyes: 'Vision',
  ears: 'Hearing',
  mouth: 'Dental',
  neck: 'Neck & Throat',
  chest: 'Heart & Lungs',
  abdomen: 'Digestion',
  gut: 'Liver & Gut',
  spine: 'Spine & Posture',
  arms: 'Arms & Hands',
  hips: 'Hips & Pelvis',
  legs: 'Legs & Knees',
  feet: 'Feet',
  recovery: 'Sleep & Recovery',
  nervous: 'Stress & Nervous System',
  activity: 'Movement & Activity',
  composition: 'Body Composition',
  vitality: 'Energy & Hormones',
  general: 'General',
};

export function isRegion(d: DomainId): d is RegionId {
  return (REGION_IDS as readonly string[]).includes(d);
}

/* ── metric → domain mapping ──────────────────────────────────────── */

/** Exact + keyword table (keyword fallback scans in insertion order, so
 *  more specific words sit above generic ones). */
const METRIC_DOMAIN: Record<string, DomainId> = {
  // hair / scalp
  hair: 'hair', scalp: 'hair',
  // eyes / vision
  eye: 'eyes', eyes: 'eyes', vision: 'eyes', sight: 'eyes',
  // ears / hearing
  ear: 'ears', ears: 'ears', hearing: 'ears', tinnitus: 'ears',
  // mouth / dental
  mouth: 'mouth', dental: 'mouth', teeth: 'mouth', tooth: 'mouth', gum: 'mouth', oral: 'mouth',
  // mind (cognitive state that is not stress)
  brain: 'head', mind: 'head', memory: 'head', cognition: 'head', focus: 'head',
  mood: 'head', mental: 'head', headache: 'head', migraine: 'head',
  // neck / throat
  neck: 'neck', throat: 'neck', thyroid: 'neck',
  // chest / heart / lungs
  heart: 'chest', hrv: 'chest', pulse: 'chest', cardio: 'chest', chest: 'chest',
  blood_pressure: 'chest', bp: 'chest', lung: 'chest', breath: 'chest', respiratory: 'chest',
  // abdomen / digestion / metabolism
  digestion: 'abdomen', stomach: 'abdomen', bloating: 'abdomen', nutrition: 'abdomen',
  diet: 'abdomen', hydration: 'abdomen', metabolism: 'abdomen',
  // liver / gut organs
  liver: 'gut', gut: 'gut', kidney: 'gut', intestine: 'gut',
  // spine / posture
  spine: 'spine', posture: 'spine', back: 'spine',
  // arms / hands
  arm: 'arms', hand: 'arms', wrist: 'arms', shoulder: 'arms', elbow: 'arms',
  grip: 'arms', strength: 'arms', mobility: 'arms',
  // hips / pelvis
  hip: 'hips', pelvis: 'hips', pelvic: 'hips',
  // legs / knees
  leg: 'legs', knee: 'legs', ankle: 'legs', calf: 'legs', thigh: 'legs',
  // feet
  foot: 'feet', feet: 'feet', toe: 'feet',
  // systemic — sleep / recovery
  sleep: 'recovery', recovery: 'recovery', rest: 'recovery', nap: 'recovery',
  // systemic — stress / nervous
  stress: 'nervous', anxiety: 'nervous', tension: 'nervous', burnout: 'nervous', nervous: 'nervous',
  // systemic — movement / activity / wellness habits
  activity: 'activity', steps: 'activity', walking: 'activity', running: 'activity',
  cycling: 'activity', exercise: 'activity', movement: 'activity', workout: 'activity',
  training: 'activity', habit: 'activity',
  // systemic — body composition
  weight: 'composition', bmi: 'composition', fat: 'composition', muscle: 'composition',
  composition: 'composition', mass: 'composition',
  // systemic — energy / hormones
  energy: 'vitality', hormone: 'vitality', testosterone: 'vitality', cortisol: 'vitality',
  vitality: 'vitality', wellbeing: 'vitality',
  // systemic — general whole-body signals
  symptom: 'general', pain: 'general', immunity: 'general', illness: 'general',
};

export function domainForMetric(metric: string): DomainId {
  const key = metric.trim().toLowerCase();
  if (METRIC_DOMAIN[key]) return METRIC_DOMAIN[key];
  for (const [word, domain] of Object.entries(METRIC_DOMAIN)) {
    if (key.includes(word)) return domain;
  }
  return 'general'; // unknown → whole-body layer, never dropped
}

/* ── severity model ───────────────────────────────────────────────── */

export type Severity = 'critical' | 'attention' | 'moderate' | 'optimal' | 'noted';

/** Worst-first ordering for sorting and summaries. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'attention', 'moderate', 'optimal', 'noted'] as const;

export function metricSeverity(m: BodyMetric): Severity {
  if (m.concern) return m.level !== null && m.level <= 3 ? 'critical' : 'attention';
  if (m.level === null) return 'noted';
  if (m.level < 4) return 'attention';
  if (m.level <= 6) return 'moderate';
  return 'optimal';
}

/** CSS variable per severity — the single color vocabulary of the surface. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--err)',
  attention: 'var(--warn)',
  moderate: 'var(--accent)',
  optimal: 'var(--ok)',
  noted: 'var(--muted, #97a0b8)',
};

const worse = (a: Severity, b: Severity): Severity =>
  SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b;

/* ── model ────────────────────────────────────────────────────────── */

export interface DomainState {
  domain: DomainId;
  label: string;
  systemic: boolean;
  metrics: BodyMetric[];
  active: boolean;
  concern: boolean;
  severity: Severity;
  /** Lowest reported level in the domain (null when no metric carries one). */
  worstLevel: number | null;
}

export interface HealthModel {
  domains: Record<DomainId, DomainState>;
  /** Active domains, worst severity first (stable secondary order: registry order). */
  activeDomains: DomainState[];
  signalCount: number;
  concernCount: number;
  /** Mean of all reported levels, one decimal — derived, never invented. */
  averageLevel: number | null;
}

export function buildHealthModel(metrics: BodyMetric[]): HealthModel {
  const domains = {} as Record<DomainId, DomainState>;
  for (const id of [...REGION_IDS, ...LAYER_IDS]) {
    domains[id] = {
      domain: id, label: DOMAIN_LABELS[id], systemic: !isRegion(id),
      metrics: [], active: false, concern: false, severity: 'noted', worstLevel: null,
    };
  }

  let levelSum = 0;
  let levelCount = 0;
  let concerns = 0;
  for (const m of metrics) {
    const state = domains[domainForMetric(m.metric)];
    state.metrics.push(m);
    const sev = metricSeverity(m);
    state.severity = state.active ? worse(state.severity, sev) : sev;
    state.active = true;
    if (m.concern) { state.concern = true; concerns++; }
    if (typeof m.level === 'number') {
      state.worstLevel = state.worstLevel === null ? m.level : Math.min(state.worstLevel, m.level);
      levelSum += m.level;
      levelCount++;
    }
  }

  const registryOrder = [...REGION_IDS, ...LAYER_IDS];
  const activeDomains = registryOrder
    .map((id) => domains[id])
    .filter((d) => d.active)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return {
    domains,
    activeDomains,
    signalCount: metrics.length,
    concernCount: concerns,
    averageLevel: levelCount > 0 ? Math.round((levelSum / levelCount) * 10) / 10 : null,
  };
}

/* ── formatting helpers shared by scan + rails + strips ───────────── */

export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function formatMetricValue(m: BodyMetric): string {
  if (typeof m.level === 'number') return `${m.level}/10`;
  if (m.detail) return m.detail.length > 16 ? `${m.detail.slice(0, 15)}…` : m.detail;
  return 'noted';
}

/** Compact chip text for a domain: worst metric value plus overflow count. */
export function domainChipText(state: DomainState): string {
  if (!state.active) return state.label;
  const primary = [...state.metrics].sort(
    (a, b) => SEVERITY_ORDER.indexOf(metricSeverity(a)) - SEVERITY_ORDER.indexOf(metricSeverity(b)),
  )[0];
  const extra = state.metrics.length > 1 ? ` +${state.metrics.length - 1}` : '';
  return `${formatMetricValue(primary)}${extra}`;
}
