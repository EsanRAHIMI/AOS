import { z } from 'zod';
import { IsoDate } from './common.js';

export const AgentRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled']);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

/** A single execution of an agent against a task. */
export const AgentRunSchema = z.object({
  agentRunId: z.string(),
  agentId: z.string(),
  serviceId: z.string(),
  taskId: z.string(),
  status: AgentRunStatus,
  model: z.string().optional(),
  steps: z.number().default(0),
  tokensIn: z.number().default(0),
  tokensOut: z.number().default(0),
  costUsd: z.number().default(0),
  startedAt: IsoDate,
  finishedAt: IsoDate.nullable().default(null),
  summary: z.string().optional(),
  error: z.string().nullable().default(null),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

/** A message in an agent run (prompt/response/tool-call), stored for memory + training. */
export const AgentMessageSchema = z.object({
  messageId: z.string(),
  agentRunId: z.string(),
  taskId: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolName: z.string().optional(),
  createdAt: IsoDate,
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
