/**
 * Gateway routes — intelligence group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, agentPrompts, failure, llmStatusFromEnv, success } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerIntelligenceRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    guard,
    deny,
    events,
    llmCostRecords,
    llmBudgetEvents,
    researchRuns,
    researchSources,
    researchReports,
    reviewReports,
    qaReports,
    intelligenceReports,
  } = deps;

      // --- Phase 13: Real Intelligence reads -----------------------------
      app.get('/v1/llm/prompts', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(agentPrompts());
      });
      app.get('/v1/llm/costs', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const records = await llmCostRecords.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1000).toArray();
        const todayPrefix = new Date().toISOString().slice(0, 10);
        const byProvider: Record<string, { calls: number; costUsd: number }> = {};
        const byAgent: Record<string, { calls: number; costUsd: number }> = {};
        const byTask: Record<string, number> = {};
        let totalToday = 0, totalAll = 0, fallbackCount = 0, realCount = 0;
        for (const r of records) {
          totalAll += r.costUsd;
          if (String(r.createdAt).slice(0, 10) === todayPrefix) totalToday += r.costUsd;
          (byProvider[r.provider] ??= { calls: 0, costUsd: 0 }).calls++; byProvider[r.provider]!.costUsd += r.costUsd;
          (byAgent[r.agentId] ??= { calls: 0, costUsd: 0 }).calls++; byAgent[r.agentId]!.costUsd += r.costUsd;
          if (r.taskId) byTask[r.taskId] = (byTask[r.taskId] ?? 0) + r.costUsd;
          if (r.usedFallback) fallbackCount++; else realCount++;
        }
        const mostExpensiveTask = Object.entries(byTask).sort((a, b) => b[1] - a[1])[0] ?? null;
        return success({
          status: llmStatusFromEnv(),
          totals: { today: Number(totalToday.toFixed(4)), allTime: Number(totalAll.toFixed(4)), calls: records.length, realCount, fallbackCount },
          byProvider, byAgent,
          mostExpensiveTask: mostExpensiveTask ? { taskId: mostExpensiveTask[0], costUsd: Number(mostExpensiveTask[1].toFixed(4)) } : null,
          recent: records.slice(0, 50),
        });
      });
      app.get('/v1/llm/budget-events', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await llmBudgetEvents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/research', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await researchReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/research/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const report = await researchReports.findOne({ reportId: req.params.id }, { projection: { _id: 0 } });
        if (!report) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'research report not found'));
        const [run, sources] = await Promise.all([
          researchRuns.findOne({ runId: report.runId }, { projection: { _id: 0 } }),
          researchSources.find({ runId: report.runId }, { projection: { _id: 0 } }).toArray(),
        ]);
        return success({ report, run, sources });
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/reviews', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await reviewReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/qa', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await qaReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/reports', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await intelligenceReports.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });

}
