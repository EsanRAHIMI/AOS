/**
 * Evaluation engine. Scores a target (capability/service/agent/task/expansion)
 * across explicit dimensions so the system never hallucinates progress. Scoring
 * is deterministic from observed signals; strengths/weaknesses/recommendations
 * are derived from the same signals.
 */
import { genId, nowIso } from '../utils/index.js';
import type { Evaluation } from '../schemas/capability.js';

export interface EvaluationSignals {
  docsUpdated?: boolean;
  memoryStored?: boolean;
  scaffoldCreated?: boolean;
  infraRequested?: boolean;
  runtimeValidated?: boolean;
  humanInterventionRequired?: boolean;
  delegationsSucceeded?: number;
  delegationsAttempted?: number;
  approvalUsed?: boolean;
  durationMs?: number;
  costUsd?: number;
}

export interface BuildEvaluationInput {
  targetType: Evaluation['targetType'];
  targetId: string;
  taskId?: string | null;
  signals: EvaluationSignals;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, Number(n.toFixed(3))));

export function buildEvaluation(input: BuildEvaluationInput): Evaluation {
  const s = input.signals;
  const ratio = s.delegationsAttempted ? (s.delegationsSucceeded ?? 0) / s.delegationsAttempted : 1;

  const dimensions = {
    correctness: clamp(0.5 + 0.4 * ratio + (s.scaffoldCreated ? 0.1 : 0)),
    reliability: clamp(0.4 + 0.5 * ratio),
    speed: clamp(s.durationMs ? Math.max(0.4, 1 - s.durationMs / 60000) : 0.8),
    cost: clamp(s.costUsd ? Math.max(0.3, 1 - s.costUsd) : 0.95),
    // Lower is better for human intervention; expressed as a 0..1 quality (1 = autonomous).
    humanInterventionRequired: clamp(s.humanInterventionRequired ? 0.6 : 0.9),
    reusability: clamp((s.memoryStored ? 0.5 : 0.2) + (s.scaffoldCreated ? 0.4 : 0.2)),
    documentationQuality: clamp(s.docsUpdated ? 0.85 : 0.4),
    memoryQuality: clamp(s.memoryStored ? 0.8 : 0.4),
    // Lower risk → higher score.
    risk: clamp(s.infraRequested ? 0.6 : 0.85),
    productionReadiness: clamp((s.runtimeValidated ? 0.7 : 0.45) + (s.docsUpdated ? 0.1 : 0)),
  };

  const values = Object.values(dimensions);
  const score = clamp(values.reduce((a, b) => a + b, 0) / values.length);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  if (s.scaffoldCreated) strengths.push('Generated a standard service scaffold with manifest and factory endpoints.');
  if (s.docsUpdated) strengths.push('Documentation updated automatically.');
  if (s.memoryStored) strengths.push('Reusable memory/skill recorded.');
  if (ratio >= 1 && (s.delegationsAttempted ?? 0) > 0) strengths.push('All delegations succeeded.');
  if (s.approvalUsed) strengths.push('Sensitive action correctly gated on human approval.');

  if (!s.runtimeValidated) {
    weaknesses.push('No runtime validation of the new capability yet.');
    recommendations.push('Add automated smoke-test generation and execution for new services.');
  }
  if (!s.docsUpdated) recommendations.push('Ensure documentation-service is reachable to record outcomes.');
  if ((s.delegationsAttempted ?? 0) > 0 && ratio < 1) {
    weaknesses.push('Some delegations did not complete.');
    recommendations.push('Check peer service URLs and health before delegating.');
  }
  if (s.infraRequested) recommendations.push('Confirm the infrastructure request in Dokploy to activate the capability.');

  return {
    evaluationId: genId('eval'),
    targetType: input.targetType,
    targetId: input.targetId,
    taskId: input.taskId ?? null,
    score,
    dimensions,
    strengths,
    weaknesses,
    recommendations,
    createdAt: nowIso(),
  };
}
