/**
 * Documentation Service — service construction (K1 Consolidation Prep
 * Batch 2A, D-172).
 *
 * Split out from index.ts, same pattern as architect-agent's server.ts/
 * index.ts split (D-168): this file builds the exact service (manifest,
 * task handler, custom /docs routes, standard endpoints) without listening
 * on a real port or requiring a real Mongo connection, so characterization
 * tests can exercise it in-process via app.inject() + an injected test Db.
 * No behavior change from the original single-file version.
 */
import {
  collection,
  COLLECTIONS,
  EVENT_TYPES,
  hasValidInternalToken,
  success,
  failure,
  ERROR_CODES,
  genId,
  nowIso,
  type Collection,
} from '@factory/shared';
import { createFactoryService, type FactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

export { manifest };

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

/** Upsert a document by slug, bumping its version. Returns the new version. */
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

/** Append a dated entry to a running log document (phase-log, decision-log). */
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

export interface DocumentationServiceEnv {
  SERVICE_PORT: number;
  FACTORY_INTERNAL_TOKEN: string;
  FACTORY_ADMIN_TOKEN?: string;
  SERVICE_REGISTRY_URL?: string;
  EVENT_BUS_URL?: string;
  LOG_LEVEL?: string;
}

export async function buildDocumentationServiceService(env: DocumentationServiceEnv): Promise<FactoryService> {
  const docs = collection<DocRecord>(COLLECTIONS.DOCUMENTS);
  const handleTask = buildHandleTask(docs);

  return createFactoryService({
    manifest,
    port: env.SERVICE_PORT,
    internalToken: env.FACTORY_INTERNAL_TOKEN,
    adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL,
    eventBusUrl: env.EVENT_BUS_URL,
    logLevel: env.LOG_LEVEL,
    taskHandler: handleTask,
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
