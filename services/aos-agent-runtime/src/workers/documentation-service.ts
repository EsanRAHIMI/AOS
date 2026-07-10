/**
 * Documentation Service worker (K1 Consolidation Prep Batch 2A, D-172).
 *
 * Deliberately duplicated from services/documentation-service/src/server.ts,
 * not imported — every service in this repo is independently deployable/
 * buildable and none imports another service's source (see
 * docs/development-rules.md). This copy and the original are kept
 * behaviorally identical by
 * services/aos-agent-runtime/test/characterization.consolidated.batch2a.test.ts,
 * which re-runs documentation-service's own baseline characterization
 * assertions against THIS build. If you change one, change both and re-run
 * both suites.
 *
 * serviceId and port are hardcoded here (not read from any shared/generic
 * env var) so this worker keeps its historical identity/domain/port no
 * matter what SERVICE_ID/SERVICE_PORT the hosting aos-agent-runtime process
 * itself was started with — see index.ts's top comment.
 */
import {
  collection, COLLECTIONS, EVENT_TYPES, hasValidInternalToken, success, failure, ERROR_CODES, genId, nowIso,
  SERVICE_PORTS, SERVICE_SUBDOMAINS, SERVICE_VERSION,
  type Collection, type ServiceManifest,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';

export const manifest: ServiceManifest = {
  serviceId: 'documentation-service',
  serviceName: 'Documentation Service',
  serviceType: 'infra',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['documentation-service']}`,
  healthEndpoint: '/health',
  capabilities: ['store_document', 'list_documents', 'get_document', 'version_document'],
  dependencies: ['event-bus-service'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};

export interface DocRecord {
  documentId: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  summary: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export async function upsertDoc(
  docs: Collection<DocRecord>,
  d: { slug: string; title: string; category: string; body: string; summary?: string },
): Promise<number> {
  const now = nowIso();
  const existing = await docs.findOne({ slug: d.slug });
  const version = (existing?.version ?? 0) + 1;
  await docs.updateOne(
    { slug: d.slug },
    {
      $set: { title: d.title, category: d.category, body: d.body, summary: d.summary ?? '', version, updatedAt: now },
      $setOnInsert: { documentId: genId('doc'), slug: d.slug, createdAt: now },
    },
    { upsert: true },
  );
  return version;
}

async function appendLog(docs: Collection<DocRecord>, slug: string, title: string, entry: string): Promise<number> {
  const existing = await docs.findOne({ slug });
  const body = `${existing?.body ?? `# ${title}\n`}\n- ${nowIso()} — ${entry}`;
  return upsertDoc(docs, { slug, title, category: 'log', body, summary: `Most recent: ${entry}` });
}

export function buildHandleTask(docs: Collection<DocRecord>): TaskHandler {
  return async (req, ctx) => {
    const taskId = req.taskId ?? 'unknown';
    const summary = String((req.input as Record<string, unknown>)?.summary ?? req.goal);
    const infraId = (req.input as Record<string, unknown>)?.infrastructureRequestId;
    const v1 = await appendLog(docs, 'phase-log', 'Phase Log', `Task ${taskId}: ${summary}`);
    const v2 = await appendLog(
      docs,
      'decision-log',
      'Decision Log',
      `Task ${taskId} ran the standard pipeline${infraId ? `; infra request ${String(infraId)} created (awaiting approval)` : ''}.`,
    );
    const serviceSlug = `task-${taskId}`;
    const v3 = await upsertDoc(docs, {
      slug: serviceSlug,
      title: `Task ${taskId}`,
      category: 'task',
      body: `# Task ${taskId}\n\nGoal: ${req.goal}\n\nOutcome: pipeline executed (architect, builder, devops, documentation, memory).`,
      summary: req.goal,
    });
    for (const slug of ['phase-log', 'decision-log', serviceSlug]) {
      await ctx.publisher.publish({ type: EVENT_TYPES.DOC_UPDATED, taskId, payload: { slug, message: `Documentation updated: ${slug}` } });
    }
    return { taskId, accepted: true, updated: ['phase-log', 'decision-log', serviceSlug], versions: [v1, v2, v3] };
  };
}

export interface WorkerEnv {
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildDocumentationServiceWorker(env: WorkerEnv): Promise<FactoryService> {
  const docs = collection<DocRecord>(COLLECTIONS.DOCUMENTS);
  const handleTask = buildHandleTask(docs);

  return createFactoryService({
    manifest, port: SERVICE_PORTS['documentation-service'], internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
    // K1 Consolidation Prep (D-172): this instance shares a process with
    // siblings — the entrypoint (index.ts) owns ONE shared shutdown handler
    // instead. See @factory/service-kit's registerSignalHandlers doc.
    registerSignalHandlers: false,
    routes: (app, ctx) => {
      const guard = (req: { headers: Record<string, string | string[] | undefined> }) =>
        hasValidInternalToken({ headers: req.headers, expectedInternalToken: env.FACTORY_INTERNAL_TOKEN });

      app.post<{
        Body: { slug: string; title: string; category: string; body: string; summary?: string };
      }>('/docs', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const b = req.body;
        if (!b?.slug || !b?.title || !b?.body) {
          return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'slug, title, body required'));
        }
        const now = nowIso();
        const existing = await docs.findOne({ slug: b.slug });
        const version = (existing?.version ?? 0) + 1;
        await docs.updateOne(
          { slug: b.slug },
          {
            $set: {
              title: b.title,
              category: b.category ?? 'general',
              body: b.body,
              summary: b.summary ?? '',
              version,
              updatedAt: now,
            },
            $setOnInsert: { documentId: genId('doc'), slug: b.slug, createdAt: now },
          },
          { upsert: true },
        );
        await ctx.publisher.publish({
          type: EVENT_TYPES.DOC_UPDATED,
          taskId: null,
          payload: { slug: b.slug, version },
        });
        return success({ slug: b.slug, version });
      });

      app.get('/docs', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const all = await docs
          .find({}, { projection: { _id: 0, body: 0 } })
          .sort({ updatedAt: -1 })
          .toArray();
        return success(all);
      });

      app.get<{ Params: { slug: string } }>('/docs/:slug', async (req, reply) => {
        if (!guard(req)) return reply.code(401).send(failure(ERROR_CODES.UNAUTHORIZED, 'internal token required'));
        const rec = await docs.findOne({ slug: req.params.slug }, { projection: { _id: 0 } });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'document not found'));
        return success(rec);
      });
    },
  });
}
