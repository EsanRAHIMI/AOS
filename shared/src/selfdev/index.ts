/**
 * Self-Development Pipeline record (K2, D-177; mandate §I).
 *
 * A durable, evidence-linked record of the bounded self-improvement loop:
 * gap → investigate → decide → propose → APPROVE → implement (real branch +
 * diff via code-operator) → verify (typecheck/tests/build) → review/QA →
 * reflect. This module owns the STATE MACHINE and evidence bundle; the actual
 * code changes run through the existing code-operator workspace runtime
 * (real git worktree, real checks — never fabricated PR metadata). Protected
 * core stays owner-approved; nothing here can delete safety/approval/audit
 * controls.
 */
import { z } from 'zod';
import { collection } from '../db/index.js';
import { COLLECTIONS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import { IsoDate } from '../schemas/common.js';
import { ScopeFieldsSchema } from '../schemas/scope.js';

export const SelfDevStage = z.enum([
  'gap_identified', 'investigating', 'decided', 'proposed', 'approved',
  'implementing', 'verifying', 'reviewing', 'awaiting_merge_approval',
  'merged', 'verified_post_change', 'reflected', 'rejected', 'postponed',
]);
export type SelfDevStage = z.infer<typeof SelfDevStage>;

export const SelfDevDecision = z.enum(['use_internal', 'integrate_oss', 'build', 'postpone', 'reject']);
export type SelfDevDecision = z.infer<typeof SelfDevDecision>;

export const SelfDevRunSchema = z.object({
  selfDevId: z.string(),
  title: z.string(),
  /** Where the gap came from (mandate §I.1). */
  gapSource: z.enum(['owner_objective', 'failed_mission', 'repeated_workaround', 'code_evidence', 'external_research']),
  gapEvidence: z.array(z.string()).default([]),   // memoryIds / sourceIds / runIds
  investigation: z.string().default(''),
  alternatives: z.array(z.string()).default([]),
  decision: SelfDevDecision.nullable().default(null),
  decisionRationale: z.string().default(''),
  proposalSummary: z.string().default(''),
  boundedChange: z.string().default(''),
  stage: SelfDevStage.default('gap_identified'),
  workspaceId: z.string().nullable().default(null),
  branch: z.string().default(''),
  diffSummary: z.string().default(''),
  checks: z.object({ typecheck: z.string().default(''), test: z.string().default(''), build: z.string().default('') }).default({ typecheck: '', test: '', build: '' }),
  reviewFindings: z.array(z.string()).default([]),
  qaFindings: z.array(z.string()).default([]),
  evidenceBundleIds: z.array(z.string()).default([]),
  rollbackPlan: z.string().default(''),
  mergeRecommendation: z.string().default(''),
  outcomeBefore: z.string().default(''),
  outcomeAfter: z.string().default(''),
  lesson: z.string().default(''),
  approvalId: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
}).merge(ScopeFieldsSchema);
export type SelfDevRun = z.infer<typeof SelfDevRunSchema>;

const runs = () => collection<SelfDevRun>(COLLECTIONS.SELF_DEV_RUNS);

export interface SelfDevActor { actorId: string; scope: 'global'; tenantId?: string | null }

/** Legal stage transitions — the pipeline can never skip approval before
 *  implementing, or merge before verification (mandate §I.5/§I.11). */
const NEXT: Record<SelfDevStage, SelfDevStage[]> = {
  gap_identified: ['investigating', 'rejected', 'postponed'],
  investigating: ['decided', 'rejected', 'postponed'],
  decided: ['proposed', 'rejected', 'postponed'],
  proposed: ['approved', 'rejected', 'postponed'],
  approved: ['implementing'],
  implementing: ['verifying', 'rejected'],
  verifying: ['reviewing', 'implementing'],
  reviewing: ['awaiting_merge_approval', 'implementing', 'rejected'],
  awaiting_merge_approval: ['merged', 'rejected'],
  merged: ['verified_post_change'],
  verified_post_change: ['reflected'],
  reflected: [],
  rejected: [],
  postponed: ['investigating'],
};

export function canTransition(from: SelfDevStage, to: SelfDevStage): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

export async function createSelfDevRun(actor: SelfDevActor, args: { title: string; gapSource: SelfDevRun['gapSource']; gapEvidence?: string[] }): Promise<SelfDevRun> {
  const now = nowIso();
  const run = SelfDevRunSchema.parse({
    selfDevId: genId('sdev'), title: args.title, gapSource: args.gapSource, gapEvidence: args.gapEvidence ?? [],
    stage: 'gap_identified', createdAt: now, updatedAt: now, scope: 'global', createdBy: actor.actorId, visibility: 'public',
  });
  await runs().insertOne(run);
  return run;
}

export async function advanceSelfDevRun(selfDevId: string, to: SelfDevStage, patch: Partial<SelfDevRun> = {}): Promise<SelfDevRun> {
  const run = await runs().findOne({ selfDevId });
  if (!run) throw new Error(`self-dev run ${selfDevId} not found`);
  if (!canTransition(run.stage, to)) throw new Error(`illegal transition ${run.stage} → ${to} (approval/verification gates enforced)`);
  const updated = { ...patch, stage: to, updatedAt: nowIso() };
  await runs().updateOne({ selfDevId }, { $set: updated });
  return { ...run, ...updated } as SelfDevRun;
}

export async function getSelfDevRun(selfDevId: string): Promise<SelfDevRun | null> {
  return runs().findOne({ selfDevId }, { projection: { _id: 0 } as never });
}

export async function listSelfDevRuns(limit = 50): Promise<SelfDevRun[]> {
  return runs().find({}, { projection: { _id: 0 } as never }).sort({ updatedAt: -1 }).limit(limit).toArray();
}
