import { z } from 'zod';
import { IsoDate, Confidence } from './common.js';

export const MemoryType = z.enum([
  'task_memory',
  'decision_memory',
  'architecture_memory',
  'error_memory',
  'solution_memory',
  'user_preference_memory',
  'service_memory',
  'deployment_memory',
  'research_memory',
  'skill_memory',
]);
export type MemoryType = z.infer<typeof MemoryType>;

/** A compact, reusable memory record optimized for future agent context. */
export const MemorySchema = z.object({
  memoryId: z.string(),
  type: MemoryType,
  title: z.string(),
  summary: z.string(),                    // token-efficient summary
  taskId: z.string().nullable().default(null),
  serviceId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  confidence: Confidence.default('medium'),
  createdAt: IsoDate,
});
export type Memory = z.infer<typeof MemorySchema>;

/** A repeated successful pattern promoted into a reusable skill (Phase 3). */
export const SkillSchema = z.object({
  skillId: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string().default('general'),
  triggerConditions: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
  requiredServices: z.array(z.string()).default([]),
  steps: z.array(z.string()),
  examples: z.array(z.string()).default([]),
  successRate: z.number().min(0).max(1).default(1),
  usageCount: z.number().default(0),
  relatedMemories: z.array(z.string()).default([]),
  relatedDocs: z.array(z.string()).default([]),
  confidence: Confidence.default('medium'),
  lastUsedAt: IsoDate.nullable().default(null),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Skill = z.infer<typeof SkillSchema>;
