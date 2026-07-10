/**
 * Memory Agent worker (K1 Consolidation Prep Batch 2A, D-172).
 *
 * Deliberately duplicated from services/memory-agent/src/server.ts, not
 * imported — every service in this repo is independently deployable/
 * buildable and none imports another service's source (see
 * docs/development-rules.md). This copy and the original are kept
 * behaviorally identical by
 * services/aos-agent-runtime/test/characterization.consolidated.batch2a.test.ts,
 * which re-runs memory-agent's own baseline characterization assertions
 * against THIS build. If you change one, change both and re-run both
 * suites.
 *
 * serviceId and port are hardcoded here (not read from any shared/generic
 * env var) so this worker keeps its historical identity/domain/port no
 * matter what SERVICE_ID/SERVICE_PORT the hosting aos-agent-runtime process
 * itself was started with — see index.ts's top comment.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES, genId, nowIso, startAgentRun, finishAgentRun,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type Memory, type Skill, type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'memory-agent',
  serviceName: 'Memory Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['memory-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'store_task_history', 'store_decisions', 'store_patterns', 'extract_skills',
    'generate_compact_summaries', 'reduce_token_usage',
  ],
  dependencies: ['gateway-api', 'documentation-service', 'file-asset-service', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};

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

  let skillId: string | null = null;
  const input = (req.input ?? {}) as Record<string, unknown>;
  const skillKey = String(input.skill ?? '');
  if (skillKey) {
    const skills = collection<Skill>(COLLECTIONS.SKILLS);
    const existing = await skills.findOne({ skillId: `skill_${skillKey}` });
    const now = nowIso();
    if (existing) {
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
          'Detect capability gap', 'Create expansion proposal', 'Get human approval', 'Scaffold service from template',
          'Create Dokploy infrastructure request', 'Update documentation', 'Store memory', 'Evaluate result',
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

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildMemoryAgentWorker(env: WorkerEnv): Promise<FactoryService> {
  return createFactoryService({
    manifest, port: SERVICE_PORTS['memory-agent'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    registerSignalHandlers: false,
  });
}
