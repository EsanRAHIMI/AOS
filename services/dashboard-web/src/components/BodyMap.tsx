'use client';
/** Phase AH.2 — public entry point of the Body & Health visual.
 *
 *  `BodyMap` is kept as the stable name both surfaces import (homepage
 *  health card via HomeLive, /health room via DomainRoom) — the actual
 *  system now lives in components/health/:
 *
 *    HealthIntelligence — layered surface (summary · scan · systemic layer
 *                         strip · hover detail · full-variant breakdown)
 *    BodyScan           — refined anatomical SVG with severity-graded
 *                         rail chips and per-region hotspots
 *    lib/bodyZones.ts   — pure health-domain model (14 anatomical regions,
 *                         6 systemic layers, graded severity)
 *
 *  The `BodyMetric` data contract is unchanged since Phase AC, so no
 *  consumer or gateway change was needed for this rebuild.
 */
import { HealthIntelligence } from './health/HealthIntelligence';
import type { BodyMetric } from '@/lib/bodyZones';

export type { BodyMetric };

export function BodyMap({ metrics, variant = 'compact' }: { metrics: BodyMetric[]; variant?: 'compact' | 'full' }) {
  return <HealthIntelligence metrics={metrics} variant={variant} />;
}
