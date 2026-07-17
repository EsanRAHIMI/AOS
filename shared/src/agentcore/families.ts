/**
 * Core governed tool families (K2, D-177; mandate §B "make these real").
 *
 * Fully-real families implemented directly against the modules in this
 * repo: memory (v2), missions, research (independent stack), session
 * utilities and watches. Families whose executor must live in a service
 * process (kernel task dispatch, service health, code-operator access,
 * personal-domain repositories) are injected via `deps` by the hosting
 * process (gateway binds its real implementations at boot); when a dep is
 * absent the tool registers `available:false` with the exact reason —
 * capability truth, never inflation.
 */
import { z } from 'zod';
import { AgentToolRegistry, type ToolExecutionContext, type ToolResult } from './registry.js';
import {
  buildMemoryContext, correctMemory, deleteMemory, getMemory, listMemories,
  pinMemory, recordMemory, searchMemories, MemoryKind, MemoryStatus,
} from '../memory2/index.js';
import {
  assessMissionHealth, createMissionNode, getMissionTree, listMissionNodes,
  MissionNodeType, MissionNodeStatus, updateMissionNode,
} from '../missions/index.js';
import { webSearchProviderFromEnv } from '../research/index.js';
import { fetchAndExtract, fetchFeed, researchCoverageStatus, searxngConfigFromEnv } from '../research/providers.js';
import { pinFactToSession } from '../jarvis/session.js';

type Publish = (e: { type: string; taskId: string | null; payload: Record<string, unknown> }) => Promise<boolean> | boolean;

export interface CoreFamilyDeps {
  publish?: Publish;
  env?: NodeJS.ProcessEnv;
  /** Kernel-task dispatch (gateway wires dispatchViaQueueOrHttp). */
  dispatchKernelTask?: (goal: string, input: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<{ ok: boolean; summary: string; taskId?: string }>;
  /** Live service health (gateway wires registry/monitor state). */
  serviceHealth?: () => Promise<{ ok: boolean; summary: string; data?: unknown }>;
  /** Code-operator bridge (inspect/search/branch-edit/typecheck...). */
  codeOperator?: (op: string, args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<{ ok: boolean; summary: string; data?: unknown; evidenceIds?: string[] }>;
  /** Personal-domain snapshot (gateway wires the personal repositories). */
  personalSnapshot?: (ctx: ToolExecutionContext) => Promise<{ ok: boolean; summary: string }>;
}

function memActor(ctx: ToolExecutionContext) {
  return { actorId: ctx.actorId, scope: ctx.scope, tenantId: ctx.tenantId ?? null, userId: ctx.userId ?? null };
}

export function buildCoreToolFamilies(deps: CoreFamilyDeps = {}): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  const env = deps.env ?? process.env;
  const publish = deps.publish;

  /* ------------------------------- memory ------------------------------- */

  registry.register({
    definition: {
      name: 'memory_search', version: '1.0.0', purpose: 'Search the owner memory (facts, preferences, commitments, decisions, lessons) by relevance.',
      family: 'memory', ownerModule: 'shared/src/memory2', inputFields: {}, outputFields: { results: 'ranked memory lines with provenance' },
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ query: z.string().describe('what to look for'), limit: z.number().int().min(1).max(20).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const res = await searchMemories(memActor(ctx), String(args.query), { limit: (args.limit as number) ?? 8 });
      if (!res.length) return { ok: true, summary: 'No matching memories.' };
      return { ok: true, summary: res.map((r) => `[${r.record.status}/${r.record.kind}] ${r.record.subject ? `${r.record.subject}: ` : ''}${r.record.content} (id:${r.record.memoryId})`).join('\n'), data: res.map((r) => r.record) };
    },
  });

  registry.register({
    definition: {
      name: 'memory_record', version: '1.0.0', purpose: 'Persist a memory (fact/preference/commitment/decision/goal/person/project). Confirmed only when the owner explicitly stated it; otherwise inferred.',
      family: 'memory', ownerModule: 'shared/src/memory2', inputFields: {}, outputFields: { memoryId: 'id' },
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: false, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: true, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({
      kind: MemoryKind.describe('memory kind'),
      status: MemoryStatus.describe('confirmed only if the owner explicitly stated it'),
      content: z.string().min(3).describe('compact natural-language content'),
      subject: z.string().optional().describe('stable dedup key, e.g. "goal:launch-aos" or a person name'),
      importance: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const { memory, action } = await recordMemory(memActor(ctx), {
        kind: args.kind as never, status: args.status as never, content: String(args.content),
        subject: (args.subject as string) ?? '', importance: (args.importance as number) ?? 0.5,
        tags: (args.tags as string[]) ?? [],
        provenance: { sourceType: args.status === 'confirmed' ? 'user_stated' : 'jarvis_inferred', sessionId: ctx.sessionId ?? null, turnId: null, runId: ctx.runId, refIds: [], sourceUrl: '' },
      }, publish);
      return { ok: true, summary: `${action}: ${memory.memoryId} (${memory.kind}/${memory.status})`, data: memory };
    },
  });

  registry.register({
    definition: {
      name: 'memory_correct', version: '1.0.0', purpose: 'Correct an existing memory record with new content (owner correction — becomes confirmed).',
      family: 'memory', ownerModule: 'shared/src/memory2', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: true, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ memoryId: z.string(), newContent: z.string().min(3) }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const res = await correctMemory(memActor(ctx), String(args.memoryId), String(args.newContent), publish);
      return res ? { ok: true, summary: `corrected ${args.memoryId}` } : { ok: false, summary: `memory ${args.memoryId} not found in scope` };
    },
  });

  registry.register({
    definition: {
      name: 'memory_delete', version: '1.0.0', purpose: 'Delete a memory record (tombstoned; embeddings removed). Sensitive: requires approval.',
      family: 'memory', ownerModule: 'shared/src/memory2', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'medium', policyCategory: 'internal_sensitive', requiresApproval: true,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: true, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ memoryId: z.string() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const ok = await deleteMemory(memActor(ctx), String(args.memoryId), publish);
      return { ok, summary: ok ? `deleted ${args.memoryId}` : `memory ${args.memoryId} not found in scope` };
    },
  });

  registry.register({
    definition: {
      name: 'memory_pin', version: '1.0.0', purpose: 'Pin or unpin a memory so it always appears in context.',
      family: 'memory', ownerModule: 'shared/src/memory2', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: true, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: true, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ memoryId: z.string(), pinned: z.boolean() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const ok = await pinMemory(memActor(ctx), String(args.memoryId), Boolean(args.pinned));
      return { ok, summary: ok ? `${args.pinned ? 'pinned' : 'unpinned'} ${args.memoryId}` : 'not found in scope' };
    },
  });

  /* ------------------------------ missions ------------------------------- */

  registry.register({
    definition: {
      name: 'mission_create', version: '1.0.0', purpose: 'Create a node in the durable objective hierarchy (vision→strategic_objective→program→mission→plan→task→action). Duplicate-guarded.',
      family: 'missions', ownerModule: 'shared/src/missions', inputFields: {}, outputFields: { nodeId: 'created node id' },
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: false, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: true, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({
      nodeType: MissionNodeType,
      title: z.string().min(3),
      description: z.string().optional(),
      parentId: z.string().nullable().optional().describe('required for every type except vision'),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      successCriteria: z.array(z.string()).optional(),
      timeHorizon: z.string().optional().describe("e.g. '90d' or '2026-Q4'"),
      dueAt: z.string().nullable().optional(),
      nextReviewAt: z.string().nullable().optional(),
      risks: z.array(z.string()).optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const { node, duplicate } = await createMissionNode(memActor(ctx), {
        nodeType: args.nodeType as never, title: String(args.title), description: (args.description as string) ?? '',
        parentId: (args.parentId as string | null) ?? null, priority: args.priority as never,
        successCriteria: (args.successCriteria as string[]) ?? [], timeHorizon: (args.timeHorizon as string) ?? '',
        dueAt: (args.dueAt as string | null) ?? null, nextReviewAt: (args.nextReviewAt as string | null) ?? null,
        risks: (args.risks as string[]) ?? [], linkedSessionId: ctx.sessionId ?? null,
      }, publish);
      return { ok: true, summary: duplicate ? `duplicate — reusing existing ${node.nodeType} "${node.title}" (id:${node.nodeId})` : `created ${node.nodeType} "${node.title}" (id:${node.nodeId})`, data: node };
    },
  });

  registry.register({
    definition: {
      name: 'mission_update', version: '1.0.0', purpose: 'Update a mission-hierarchy node: status, progress, priority, due/review dates, outcome, lesson, blockers.',
      family: 'missions', ownerModule: 'shared/src/missions', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 0, idempotent: true, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: true, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({
      nodeId: z.string(),
      status: MissionNodeStatus.optional(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      progressNote: z.string().optional(),
      blockedReason: z.string().optional(),
      dueAt: z.string().nullable().optional(),
      nextReviewAt: z.string().nullable().optional(),
      outcome: z.string().optional(),
      lesson: z.string().optional(),
      description: z.string().optional(),
    }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const { nodeId, ...patch } = args as { nodeId: string } & Record<string, unknown>;
      const res = await updateMissionNode(memActor(ctx), { nodeId, patch: patch as never }, publish);
      return res ? { ok: true, summary: `updated ${res.nodeType} "${res.title}" (${res.status})`, data: res } : { ok: false, summary: `node ${nodeId} not found in scope` };
    },
  });

  registry.register({
    definition: {
      name: 'mission_list', version: '1.0.0', purpose: 'List mission-hierarchy nodes filtered by type/status.',
      family: 'missions', ownerModule: 'shared/src/missions', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ nodeTypes: z.array(MissionNodeType).optional(), statuses: z.array(MissionNodeStatus).optional(), limit: z.number().int().max(100).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const nodes = await listMissionNodes(memActor(ctx), { nodeTypes: args.nodeTypes as never, statuses: args.statuses as never, limit: (args.limit as number) ?? 50 });
      if (!nodes.length) return { ok: true, summary: 'No mission nodes match.' };
      return { ok: true, summary: nodes.map((n) => `[${n.nodeType}/${n.status}/${n.priority}] ${n.title}${n.dueAt ? ` (due ${n.dueAt.slice(0, 10)})` : ''} (id:${n.nodeId}${n.parentId ? `, parent:${n.parentId}` : ''})`).join('\n'), data: nodes };
    },
  });

  registry.register({
    definition: {
      name: 'mission_tree', version: '1.0.0', purpose: 'Read the full subtree under a node (objective → ... → tasks).',
      family: 'missions', ownerModule: 'shared/src/missions', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 8000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ rootId: z.string() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const tree = await getMissionTree(memActor(ctx), String(args.rootId));
      if (!tree.length) return { ok: false, summary: `node ${args.rootId} not found in scope` };
      return { ok: true, summary: tree.map((n) => `${'  '.repeat(['vision', 'strategic_objective', 'program', 'mission', 'plan', 'task', 'action'].indexOf(n.nodeType))}- [${n.nodeType}/${n.status}] ${n.title} (id:${n.nodeId})`).join('\n'), data: tree };
    },
  });

  registry.register({
    definition: {
      name: 'mission_health', version: '1.0.0', purpose: 'Detect overdue, review-due, stalled and blocked mission nodes.',
      family: 'missions', ownerModule: 'shared/src/missions', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 10000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({}),
    executor: async (_args, ctx): Promise<ToolResult> => {
      const h = await assessMissionHealth(memActor(ctx));
      const fmt = (label: string, nodes: Array<{ title: string; nodeId: string }>) => nodes.length ? `${label}: ${nodes.map((n) => `${n.title} (${n.nodeId})`).join('; ')}` : '';
      const parts = [fmt('OVERDUE', h.overdue), fmt('REVIEW DUE', h.reviewDue), fmt('STALLED', h.stalled), fmt('BLOCKED', h.blocked)].filter(Boolean);
      return { ok: true, summary: parts.length ? parts.join('\n') : 'All mission nodes healthy — nothing overdue, stalled or blocked.', data: h };
    },
  });

  /* ------------------------------ research ------------------------------- */

  const searchProvider = webSearchProviderFromEnv(env);
  registry.register({
    definition: {
      name: 'research_web_search', version: '1.0.0', purpose: 'Web metasearch via self-hosted SearXNG (or optional configured adapter). Returns titles/urls/snippets — fetch pages for evidence.',
      family: 'research', ownerModule: 'shared/src/research', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 15000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'untrusted_external', available: Boolean(searchProvider),
      unavailableReason: searchProvider ? '' : 'no metasearch configured — set SEARXNG_BASE_URL (self-hosted, see deployment/searxng.md); direct URL/RSS research still works',
    },
    inputSchema: z.object({ query: z.string().min(2), maxResults: z.number().int().max(10).optional() }),
    availabilityCheck: () => {
      const p = webSearchProviderFromEnv(env);
      return { available: Boolean(p), reason: p ? '' : 'no metasearch configured — set SEARXNG_BASE_URL (self-hosted); direct URL/RSS research still works' };
    },
    executor: async (args, ctx): Promise<ToolResult> => {
      const provider = webSearchProviderFromEnv(env);
      if (!provider) return { ok: false, summary: 'metasearch not configured' };
      const results = await provider.search(String(args.query), { maxResults: (args.maxResults as number) ?? 6 });
      if (!results.length) return { ok: true, summary: `No results for "${args.query}" (provider: ${provider.providerId}).` };
      const { saveResearchSource } = await import('./research-save.js');
      const ids = await saveResearchSource(results, String(args.query), ctx);
      return { ok: true, summary: results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.publishedAt ? ` (${r.publishedAt.slice(0, 10)})` : ''}\n   ${r.snippet.slice(0, 200)}`).join('\n'), data: { results, sourceIds: ids }, evidenceIds: ids };
    },
  });

  registry.register({
    definition: {
      name: 'research_fetch_url', version: '1.0.0', purpose: 'Fetch a URL directly, extract readable text, and record provenance (publication + retrieval dates). Respects robots.txt.',
      family: 'research', ownerModule: 'shared/src/research/providers', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 20000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'untrusted_external', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ url: z.string().url(), maxChars: z.number().int().max(20000).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      const page = await fetchAndExtract(String(args.url), { runId: ctx.runId, actorId: ctx.actorId });
      if (page.blockedByRobots) return { ok: false, summary: `robots.txt disallows fetching ${args.url} — respected.` };
      if (page.error) return { ok: false, summary: `fetch failed: ${page.error}` };
      const cap = (args.maxChars as number) ?? 6000;
      return {
        ok: true,
        summary: `TITLE: ${page.title}\nPUBLISHED: ${page.publishedAt || 'unknown'}\nRETRIEVED: now${page.fromCache ? ' (cache)' : ''}\nSOURCE_ID: ${page.source?.sourceId ?? ''}\n---\n${page.text.slice(0, cap)}`,
        data: { sourceId: page.source?.sourceId, url: page.url, title: page.title },
        evidenceIds: page.source ? [page.source.sourceId] : [],
      };
    },
  });

  registry.register({
    definition: {
      name: 'research_fetch_feed', version: '1.0.0', purpose: 'Read an RSS/Atom feed (self-hosted-friendly current-awareness source).',
      family: 'research', ownerModule: 'shared/src/research/providers', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 15000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'untrusted_external', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ url: z.string().url(), maxItems: z.number().int().max(30).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      try {
        const items = await fetchFeed(String(args.url), { maxItems: (args.maxItems as number) ?? 15, runId: ctx.runId, actorId: ctx.actorId });
        if (!items.length) return { ok: true, summary: 'Feed parsed but contains no items.' };
        return { ok: true, summary: items.map((i) => `- ${i.title} — ${i.url}${i.publishedAt ? ` (${i.publishedAt})` : ''}`).join('\n'), data: items };
      } catch (e) {
        return { ok: false, summary: `feed fetch failed: ${e instanceof Error ? e.message : 'error'}` };
      }
    },
  });

  registry.register({
    definition: {
      name: 'research_coverage_status', version: '1.0.0', purpose: 'Honest research coverage report: which retrieval layers are configured (SearXNG, direct, RSS).',
      family: 'research', ownerModule: 'shared/src/research/providers', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 4000, maxRetries: 0, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({}),
    executor: async (): Promise<ToolResult> => {
      const s = researchCoverageStatus(env);
      return { ok: true, summary: `coverage=${s.coverage}; searxng=${s.searxng}; direct=${s.directFetch}; ${s.detail}`, data: s };
    },
  });

  /* ------------------------------ session -------------------------------- */

  registry.register({
    definition: {
      name: 'session_pin_fact', version: '1.0.0', purpose: 'Pin a short fact to the current Jarvis session so every later turn sees it.',
      family: 'session', ownerModule: 'shared/src/jarvis/session', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 5000, maxRetries: 0, idempotent: true, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: true, outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ fact: z.string().min(3).max(300) }),
    executor: async (args, ctx): Promise<ToolResult> => {
      if (!ctx.sessionId) return { ok: false, summary: 'no session in this run' };
      const ok = await pinFactToSession(memActor(ctx), ctx.sessionId, String(args.fact));
      return { ok, summary: ok ? 'pinned' : 'session not found' };
    },
  });

  /* ----------------------- injected (service) families ------------------- */

  registry.register({
    definition: {
      name: 'system_service_health', version: '1.0.0', purpose: 'Live health of AOS services (registry + monitor state).',
      family: 'system', ownerModule: 'gateway-api', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 15000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal',
      available: Boolean(deps.serviceHealth), unavailableReason: deps.serviceHealth ? '' : 'not bound by hosting process',
    },
    inputSchema: z.object({}),
    executor: async (): Promise<ToolResult> => {
      if (!deps.serviceHealth) return { ok: false, summary: 'not bound' };
      return deps.serviceHealth();
    },
  });

  registry.register({
    definition: {
      name: 'task_create', version: '1.0.0', purpose: 'Create a kernel task (delegated to orchestrator through the governed queue/HTTP dispatch).',
      family: 'tasks', ownerModule: 'gateway-api', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'medium', policyCategory: 'internal_reversible', requiresApproval: false,
      ownerOnly: false, timeoutMs: 20000, maxRetries: 0, idempotent: false, sideEffect: 'internal_write', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal',
      available: Boolean(deps.dispatchKernelTask), unavailableReason: deps.dispatchKernelTask ? '' : 'not bound by hosting process',
    },
    inputSchema: z.object({ goal: z.string().min(4), input: z.record(z.string(), z.unknown()).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => {
      if (!deps.dispatchKernelTask) return { ok: false, summary: 'not bound' };
      const res = await deps.dispatchKernelTask(String(args.goal), (args.input as Record<string, unknown>) ?? {}, ctx);
      return { ok: res.ok, summary: res.summary, data: { taskId: res.taskId } };
    },
  });

  const codeOpDef = (name: string, purpose: string, approval: boolean, risk: 'low' | 'medium' | 'high', category: 'read_only' | 'internal_sensitive' | 'protected_core', sideEffect: 'none' | 'code_change') => ({
    name, version: '1.0.0', purpose, family: 'code', ownerModule: 'code-operator-agent', inputFields: {}, outputFields: {},
    requiredActorScope: 'user' as const, permission: '', riskLevel: risk, policyCategory: category, requiresApproval: approval,
    ownerOnly: approval, timeoutMs: 60000, maxRetries: 0, idempotent: sideEffect === 'none', sideEffect, evidenceRequired: sideEffect === 'code_change',
    rollbackAvailable: sideEffect === 'code_change', outputTrust: 'trusted_internal' as const,
    available: Boolean(deps.codeOperator), unavailableReason: deps.codeOperator ? '' : 'code-operator bridge not bound by hosting process',
  });

  registry.register({
    definition: codeOpDef('code_inspect', 'Read a file or directory listing from the AOS repository (read-only, workspace-confined).', false, 'low', 'read_only', 'none'),
    inputSchema: z.object({ path: z.string(), maxBytes: z.number().int().max(100000).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => deps.codeOperator ? deps.codeOperator('inspect', args, ctx) : { ok: false, summary: 'not bound' },
  });
  registry.register({
    definition: codeOpDef('code_search', 'Search the AOS repository source (read-only).', false, 'low', 'read_only', 'none'),
    inputSchema: z.object({ pattern: z.string().min(2), glob: z.string().optional() }),
    executor: async (args, ctx): Promise<ToolResult> => deps.codeOperator ? deps.codeOperator('search', args, ctx) : { ok: false, summary: 'not bound' },
  });
  registry.register({
    definition: codeOpDef('code_branch_edit', 'Apply a bounded edit on an isolated branch/worktree through code-operator (never main, never protected core without owner approval).', true, 'high', 'internal_sensitive', 'code_change'),
    inputSchema: z.object({ description: z.string().min(10), files: z.array(z.object({ path: z.string(), content: z.string() })).min(1) }),
    executor: async (args, ctx): Promise<ToolResult> => deps.codeOperator ? deps.codeOperator('branch_edit', args, ctx) : { ok: false, summary: 'not bound' },
  });
  registry.register({
    definition: codeOpDef('code_verify', 'Run typecheck/tests/build in the isolated workspace and report real results.', false, 'medium', 'read_only', 'none'),
    inputSchema: z.object({ workspaceId: z.string().optional(), checks: z.array(z.enum(['typecheck', 'test', 'build'])).optional() }),
    executor: async (args, ctx): Promise<ToolResult> => deps.codeOperator ? deps.codeOperator('verify', args, ctx) : { ok: false, summary: 'not bound' },
  });

  registry.register({
    definition: {
      name: 'personal_snapshot', version: '1.0.0', purpose: 'Read the owner personal-domain snapshot (life items, finance items, learning tracks, health state) from real stored records.',
      family: 'personal', ownerModule: 'gateway-api/personal', inputFields: {}, outputFields: {},
      requiredActorScope: 'user', permission: '', riskLevel: 'low', policyCategory: 'read_only', requiresApproval: false,
      ownerOnly: false, timeoutMs: 10000, maxRetries: 1, idempotent: true, sideEffect: 'none', evidenceRequired: false,
      rollbackAvailable: false, outputTrust: 'trusted_internal',
      available: Boolean(deps.personalSnapshot), unavailableReason: deps.personalSnapshot ? '' : 'not bound by hosting process',
    },
    inputSchema: z.object({}),
    executor: async (_args, ctx): Promise<ToolResult> => deps.personalSnapshot ? deps.personalSnapshot(ctx) : { ok: false, summary: 'not bound' },
  });

  return registry;
}
