import { z } from 'zod';
import { IsoDate, Priority } from './common.js';

export const TaskStatus = z.enum([
  'queued',
  'planning',
  'awaiting_approval',
  'in_progress',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A unit of work the orchestrator tracks end to end. */
export const TaskSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  description: z.string().optional(),
  status: TaskStatus,
  priority: Priority.default('normal'),
  createdBy: z.string(),                 // user id or service id
  assignedServiceId: z.string().nullable().default(null),
  parentTaskId: z.string().nullable().default(null),
  requiresApproval: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  result: z.unknown().optional(),
  error: z.string().nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Task = z.infer<typeof TaskSchema>;

/** A single timeline entry shown on the dashboard /tasks/:id live view. */
export const TaskTimelineEntrySchema = z.object({
  taskId: z.string(),
  at: IsoDate,
  serviceId: z.string(),
  level: z.enum(['info', 'success', 'warn', 'error']).default('info'),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type TaskTimelineEntry = z.infer<typeof TaskTimelineEntrySchema>;

/** Payload accepted by POST /.factory/task on every service. */
export const TaskRequestSchema = z.object({
  taskId: z.string().optional(),
  goal: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  priority: Priority.default('normal'),
  parentTaskId: z.string().optional(),
});
export type TaskRequest = z.infer<typeof TaskRequestSchema>;
