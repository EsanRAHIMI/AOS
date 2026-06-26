/**
 * Plan Scoring Engine (Phase 7). Compares candidate plans across ten dimensions
 * and selects the best with an explicit justification (and reasons for rejecting
 * the others). Deterministic from plan attributes + the active capability graph,
 * so selection is explainable and testable.
 */
import { genId, nowIso } from '../utils/index.js';
import type { StrategicPlan, PlanScore } from '../schemas/reasoning.js';

const clamp = (n: number): number => Math.max(0, Math.min(1, Number(n.toFixed(3))));
const riskScore = (r: string): number => (r === 'low' ? 0.9 : r === 'medium' ? 0.6 : 0.3);

export interface ScoringResult {
  scores: PlanScore[];
  selectedPlanId: string;
  selectionReason: string;
  rejected: Array<{ planId: string; label: string; reason: string }>;
}

/** Weighted importance per dimension (sum need not be 1; normalized in total). */
const WEIGHTS = {
  successProbability: 1.4,
  risk: 1.4,
  cost: 0.8,
  speed: 0.8,
  evidenceAvailability: 1.0,
  reversibility: 1.2,
  humanIntervention: 0.8,
  capabilityFit: 1.3,
  policyCompliance: 1.2,
  longTermValue: 1.1,
};

export function scorePlans(plans: StrategicPlan[], activeCapabilities: string[]): ScoringResult {
  const active = new Set(activeCapabilities);
  const sensitive = ['create_pr', 'redeploy', 'change_env', 'delete', 'production'];

  const scores: PlanScore[] = plans.map((p) => {
    const capFit = p.requiredCapabilities.length === 0 ? 0.8 : p.requiredCapabilities.filter((c) => active.has(c)).length / p.requiredCapabilities.length;
    const sensitiveCount = p.requiredApprovals.filter((a) => sensitive.includes(a)).length;
    const dimensions = {
      successProbability: clamp(p.confidence),
      risk: clamp(riskScore(p.riskLevel)),
      cost: clamp(1 - Math.min(p.expectedCostUsd, 1)),
      speed: clamp(1 - Math.min(p.expectedTimeMinutes / 60, 1)),
      evidenceAvailability: clamp(p.validationPlan ? 0.85 : 0.4),
      reversibility: clamp(p.reversibility),
      humanIntervention: clamp(p.requiredApprovals.length === 0 ? 0.9 : 0.6 - 0.1 * Math.max(0, p.requiredApprovals.length - 1)),
      capabilityFit: clamp(capFit),
      policyCompliance: clamp(1 - 0.18 * sensitiveCount),
      longTermValue: clamp(p.label === 'ambitious_plan' ? 0.9 : p.label === 'safe_plan' ? 0.72 : 0.55),
    };
    const wsum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const total = clamp(
      (Object.entries(dimensions) as Array<[keyof typeof dimensions, number]>).reduce((acc, [k, v]) => acc + v * WEIGHTS[k], 0) / wsum,
    );
    return { scoreId: genId('score'), planId: p.planId, taskId: p.taskId, label: p.label, dimensions, total, selected: false, selectionReason: null, createdAt: nowIso() };
  });

  const ranked = [...scores].sort((a, b) => b.total - a.total);
  const best = ranked[0]!;
  best.selected = true;
  const bestPlan = plans.find((p) => p.planId === best.planId)!;
  best.selectionReason = `Highest overall score (${best.total}). ${bestPlan.riskLevel} risk, reversibility ${bestPlan.reversibility}, capability fit ${best.dimensions.capabilityFit}, ${bestPlan.requiredApprovals.length === 0 ? 'no sensitive approvals required' : 'sensitive steps gated by policy'}.`;

  const rejected = ranked.slice(1).map((s) => {
    const pl = plans.find((p) => p.planId === s.planId)!;
    return { planId: s.planId, label: s.label, reason: `Lower score (${s.total}): ${pl.riskLevel} risk, ${pl.requiredApprovals.length} approval(s), reversibility ${pl.reversibility}.` };
  });

  return { scores, selectedPlanId: best.planId, selectionReason: best.selectionReason, rejected };
}
