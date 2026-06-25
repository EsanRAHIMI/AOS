import { z } from 'zod';
import { IsoDate } from './common.js';

export const ApprovalAction = z.enum([
  'approve',
  'reject',
  'pause',
  'resume',
  'request_changes',
  'explain',
]);
export type ApprovalAction = z.infer<typeof ApprovalAction>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'changes_requested']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** A sensitive action gated on human decision. Every decision is logged. */
export const ApprovalSchema = z.object({
  approvalId: z.string(),
  taskId: z.string().nullable().default(null),
  requestedBy: z.string(),                // serviceId
  actionType: z.string(),                 // e.g. "create_production_service"
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: ApprovalStatus.default('pending'),
  decidedBy: z.string().nullable().default(null),
  decisionReason: z.string().nullable().default(null),
  createdAt: IsoDate,
  decidedAt: IsoDate.nullable().default(null),
});
export type Approval = z.infer<typeof ApprovalSchema>;
