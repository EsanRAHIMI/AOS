/**
 * Memory Agent — service construction (K1 Consolidation Prep Batch 2A, D-172).
 *
 * Split out from index.ts, same pattern as architect-agent's server.ts/
 * index.ts split (D-168): builds the exact service (manifest, task handler,
 * standard endpoints) without listening on a real port or requiring a real
 * Mongo connection, so characterization tests can exercise it in-process via
 * app.inject() + an injected test Db. No behavior change from the original
 * single-file version.
 */
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  genId,
  nowIso,
  startAgentRun,
  finishAgentRun,
  type Memory,
  type Skill,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

export const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'unknown';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_STARTED, taskId, payload: { agentRunId: runId, message: 'Memory writing task summary' } });

  const memoryId = genId('mem');
  const memory: Memory = {
    memoryId,
    type: 'task_memory',
    title: `Task summary: ${req.goal.slice(0, 60)}`,
    summary:
      `Goal: ${req.goal}. Orchestrated standard pipeline architect→builder→devops→documentation→memory. ` +
      `A Dokploy infrastructure request and an approval gate were created. ` +
      `Reusable pattern: "new independent service" — design, scaffold, infra request, doc update, memory write.`,
    taskId,
    serviceId: manifest.serviceId,
    tags: ['pipeline', 'phase2', 'new-service'],
    confidence: 'medium',
    createdAt: nowIso(),
  };

  await collection<Memory>(COLLECTIONS.MEMORIES).insertOne(memory);
  await ctx.publisher.publish({ type: EVENT_TYPES.MEMORY_WRITTEN, taskId, payload: { memoryId, message: `Memory ${memoryId} stored` } });

  // --- Skill extraction: decide whether to create or update a reusable skill ---
  let skillId: string | null = null;
  const input = (req.input ?? {}) as Record<string, unknown>;
  const skillKey = String(input.skill ?? '');
  if (skillKey) {
    const skills = collection<Skill>(COLLECTIONS.SKILLS);
    const existing = await skills.findOne({ skillId: `skill_${skillKey}` });
    const now = nowIso();
    if (existing) {
      // Reinforce an existing skill: bump usage and nudge success rate.
      await skills.updateOne(
        { skillId: existing.skillId },
        {
          $set: { lastUsedAt: now, updatedAt: now, successRate: Math.min(1, (existing.successRate + 1) / 2) },
          $inc: { usageCount: 1 },
          $addToSet: { relatedMemories: memoryId },
        },
      );
      skillId = existing.skillId;
      await ctx.publisher.publish({ type: EVENT_TYPES.SKILL_UPDATED, taskId, payload: { skillId, message: `Skill reinforced: ${skillId}` } });
    } else {
      const skill: Skill = {
        skillId: `skill_${skillKey}`,
        title: 'Create a new capability-providing service',
        description: 'Standard process to expand the kernel: detect gap → propose → approve → scaffold service → request infra → document → remember → evaluate → register capability.',
        category: 'self_expansion',
        triggerConditions: ['A required capability is missing for a goal'],
        requiredCapabilities: ['cap_service_generation', 'cap_infrastructure_request'],
        requiredServices: ['builder-agent', 'devops-agent', 'documentation-service', 'memory-agent'],
        steps: [
          'Detect capability gap',
          'Create expansion proposal',
          'Get human approval',
          'Scaffold service from template',
          'Create Dokploy infrastructure request',
          'Update documentation',
          'Store memory',
          'Evaluate result',
          'Register capability in the graph',
        ],
        examples: [String(input.capability ?? '') ? `Built service for capability ${String(input.capability)}` : 'Built a new capability service'],
        successRate: 1,
        usageCount: 1,
        relatedMemories: [memoryId],
        relatedDocs: ['phase-log', 'decision-log'],
        confidence: 'medium',
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await skills.insertOne(skill);
      skillId = skill.skillId;
      await ctx.publisher.publish({ type: EVENT_TYPES.SKILL_CREATED, taskId, payload: { skillId, message: `Skill created: ${skillId}` } });
    }
  }

  await finishAgentRun(runId, { status: 'succeeded', summary: memory.summary });
  await ctx.publisher.publish({ type: EVENT_TYPES.AGENT_RUN_FINISHED, taskId, payload: { agentRunId: runId, message: 'Memory write complete' } });

  return { taskId, accepted: true, agentRunId: runId, memoryId, skillId };
};

export interface MemoryAgentEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildMemoryAgentService(env: MemoryAgentEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
}
