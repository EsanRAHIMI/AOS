/**
 * Gateway routes — capabilities group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, EVENT_TYPES, INTERNAL_TOKEN_HEADER, failure, genId, gitHubDeliveryFromEnv, llmStatusFromEnv, nowIso, peerUrl, success, webSearchStatusFromEnv } from '@factory/shared';
import type { Capability, ExpansionProposal, Incident, RepairPlan, Task } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerCapabilitiesRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    ctx,
    guard,
    deny,
    rateLimited,
    enforce,
    tasks,
    capabilities,
    gaps,
    proposals,
    evaluations,
    llmTraces,
    skills,
    validations,
    githubOps,
    evidence,
    activations,
    checklists,
    monitorRuns,
    incidents,
    repairTasks,
    repairDiagnoses,
    repairPlans,
    strategicPlans,
    planScores,
    policyDecisions,
    decisionMemories,
    dispatchTaskToOrchestrator,
  } = deps;

      // --- Phase 3: Capability graph reads -------------------------------
      app.get('/v1/capabilities', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await capabilities.find({}, { projection: { _id: 0 } }).sort({ category: 1, title: 1 }).toArray();
        return success(rows);
      });
      app.get<{ Params: { id: string } }>('/v1/capabilities/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const c = await capabilities.findOne({ capabilityId: req.params.id }, { projection: { _id: 0 } });
        if (!c) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'capability not found'));
        return success(c);
      });
      app.get('/v1/gaps', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await gaps.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/expansion-proposals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await proposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/evaluations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await evaluations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get('/v1/skills', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await skills.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Querystring: { limit?: string } }>('/v1/llm-traces', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const rows = await llmTraces.find({}, { projection: { _id: 0, prompt: 0, completion: 0, system: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
        return success(rows);
      });

      // --- Phase 3: Expansion proposal decision (approve→build) -----------
      app.post<{ Params: { id: string }; Body: { action: string; reason?: string } }>(
        '/v1/expansion-proposals/:id/decision',
        async (req, reply) => {
          if (!guard(req)) return deny(reply);
          if (await enforce('decideExpansion', req, reply)) return reply;
          const action = req.body?.action ?? '';
          const statusMap: Record<string, ExpansionProposal['status']> = {
            approve: 'approved',
            convert_to_build: 'approved',
            reject: 'rejected',
            request_changes: 'changes_requested',
          };
          const status = statusMap[action];
          if (!status) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));

          const proposal = await proposals.findOneAndUpdate(
            { proposalId: req.params.id },
            { $set: { status, updatedAt: nowIso() } },
            { returnDocument: 'after', projection: { _id: 0 } },
          );
          if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
          await ctx.publisher.publish({
            type: EVENT_TYPES.EXPANSION_DECIDED,
            taskId: proposal.sourceTaskId,
            payload: { proposalId: proposal.proposalId, status, message: `Expansion ${status}: ${proposal.proposedServiceName}` },
          });

          // Approving an expansion converts it into a build task for the orchestrator.
          if (status === 'approved') {
            const now = nowIso();
            const buildTask: Task = {
              taskId: genId('task'),
              goal: `Build approved expansion: ${proposal.proposedServiceName}`,
              status: 'queued',
              priority: 'high',
              createdBy: 'gateway-api',
              assignedServiceId: null,
              parentTaskId: proposal.sourceTaskId,
              requiresApproval: false,
              tags: ['expansion', proposal.missingCapability],
              error: null,
              createdAt: now,
              updatedAt: now,
            };
            await tasks.insertOne(buildTask);
            await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: buildTask.taskId, payload: { goal: buildTask.goal } });
            // K1 BullMQ Producer Adoption (D-174) — see routes/tasks.ts's
            // primary call site for the full rationale; same helper, same
            // preserved fallback semantics.
            await dispatchTaskToOrchestrator({
              taskId: buildTask.taskId,
              goal: buildTask.goal,
              input: { action: 'build_from_proposal', proposalId: proposal.proposalId },
              priority: 'high',
            });
            return success({ proposal, buildTaskId: buildTask.taskId });
          }
          return success({ proposal });
        },
      );

      // --- Phase 4: Reality Execution reads ------------------------------
      app.get('/v1/validations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await validations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Params: { id: string } }>('/v1/validations/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const v = await validations.findOne({ validationId: req.params.id }, { projection: { _id: 0 } });
        if (!v) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'validation not found'));
        const ev = await evidence.find({ taskId: v.taskId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success({ validation: v, evidence: ev });
      });
      app.get('/v1/github', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rows = await githubOps.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        return success(rows);
      });
      app.get<{ Querystring: { taskId?: string; capabilityId?: string } }>('/v1/evidence', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const filter: Record<string, string> = {};
        if (req.query.taskId) filter.taskId = req.query.taskId;
        if (req.query.capabilityId) filter.capabilityId = req.query.capabilityId;
        const rows = await evidence.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(300).toArray();
        return success(rows);
      });

      // --- Phase 5: Live Activation & Runtime Autonomy -------------------
      app.get('/v1/activations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await activations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/activations/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const a = await activations.findOne({ activationId: req.params.id }, { projection: { _id: 0 } });
        if (!a) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'activation not found'));
        const ev = await evidence.find({ taskId: a.taskId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
        return success({ activation: a, evidence: ev });
      });
      app.get('/v1/checklists', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await checklists.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });
      app.post<{ Params: { id: string } }>('/v1/checklists/:id/confirm', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('confirmChecklist', req, reply)) return reply;
        const res = await checklists.findOneAndUpdate({ checklistId: req.params.id }, { $set: { status: 'deployed', updatedAt: nowIso() } }, { returnDocument: 'after', projection: { _id: 0 } });
        if (!res) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'checklist not found'));
        return success(res);
      });
      // "Run activation check" — delegate the live check to the monitor-agent.
      app.post<{ Params: { id: string }; Body: { baseUrl?: string } }>('/v1/checklists/:id/activate', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await rateLimited(req, reply, 'activation')) return reply;
        if (await enforce('runActivation', req, reply)) return reply;
        const ck = await checklists.findOne({ checklistId: req.params.id });
        if (!ck) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'checklist not found'));
        const baseUrl = req.body?.baseUrl ?? `https://${ck.subdomain}`;
        const monitor = await ctx.registry.resolve('monitor-agent');
        const monitorUrl = monitor?.domain ?? peerUrl('monitor-agent');
        try {
          const r = await fetch(`${monitorUrl}/.factory/task`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
            body: JSON.stringify({ goal: `Activate ${ck.serviceName}`, input: { action: 'activate_service', serviceName: ck.serviceName, capability: ck.capabilityId, baseUrl } }),
          });
          const body = (await r.json()) as { data?: { activation?: { passed?: boolean } } };
          const passed = Boolean(body.data?.activation?.passed);
          await checklists.updateOne({ checklistId: ck.checklistId }, { $set: { status: passed ? 'activated' : 'deployed', updatedAt: nowIso() } });
          return reply.send(body);
        } catch (e) {
          return reply.code(502).send(failure(ERROR_CODES.UPSTREAM, 'monitor-agent unreachable', String(e)));
        }
      });
      app.get('/v1/monitor', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await monitorRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.get('/v1/incidents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await incidents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get('/v1/repair-tasks', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairTasks.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      // Integration status: GitHub real/prepared, LLM real/fallback, web
      // search real/not_configured (Phase AG — this endpoint was previously
      // silent on research entirely; internet-research-service's search
      // status now reports honestly here too).
      // NOTE (Phase AG.1): `webSearchStatusFromEnv()` reads THIS process's
      // own env — it does not query internet-research-service. The service
      // that actually performs the search only needs TAVILY_API_KEY on
      // itself; this endpoint's `research.configured` is cosmetic and will
      // read false here unless gateway-api also carries the key. The
      // authoritative live signal is the `sourceMode` returned on every
      // research_topic/find_opportunities reply, not this status flag.
      app.get('/v1/system/integrations', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const gh = gitHubDeliveryFromEnv();
        return success({ github: { configured: gh.configured, mode: gh.configured ? 'github_api' : 'prepared' }, llm: llmStatusFromEnv(), research: webSearchStatusFromEnv() });
      });
      app.get('/v1/llm/status', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const traces = await llmTraces.find({}, { projection: { _id: 0, prompt: 0, completion: 0, system: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
        const real = traces.filter((t) => !t.usedFallback).length;
        const totalCost = traces.reduce((a, t) => a + Number(t.costUsd ?? 0), 0);
        return success({ status: llmStatusFromEnv(), traceCount: traces.length, realCount: real, fallbackCount: traces.length - real, invalidCount: traces.filter((t) => !t.valid).length, totalCostUsd: Number(totalCost.toFixed(4)) });
      });

      // --- Phase 6: Autonomous Repair & Execution ------------------------
      app.get('/v1/repair-diagnoses', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairDiagnoses.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get('/v1/repair-plans', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        return success(await repairPlans.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      // Incident detail: failure + diagnosis + plan + repair task + evidence.
      app.get<{ Params: { id: string } }>('/v1/incidents/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const incident = await incidents.findOne({ incidentId: req.params.id }, { projection: { _id: 0 } });
        if (!incident) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'incident not found'));
        const [diagnosis, plan, repairTask, ev] = await Promise.all([
          repairDiagnoses.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          repairPlans.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          repairTasks.findOne({ incidentId: incident.incidentId }, { projection: { _id: 0 } }),
          evidence.find({ serviceName: incident.serviceName }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
        ]);
        return success({ incident, diagnosis, plan, repairTask, evidence: ev });
      });
      app.get<{ Params: { id: string } }>('/v1/repair-tasks/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const rt = await repairTasks.findOne({ repairTaskId: req.params.id }, { projection: { _id: 0 } });
        if (!rt) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'repair task not found'));
        return success(rt);
      });

      const delegateExecuteRepair = async (repairPlanId: string, baseUrl?: string): Promise<unknown> => {
        const monitor = await ctx.registry.resolve('monitor-agent');
        const monitorUrl = monitor?.domain ?? peerUrl('monitor-agent');
        const r = await fetch(`${monitorUrl}/.factory/task`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN },
          body: JSON.stringify({ goal: 'Execute repair', input: { action: 'execute_repair', repairPlanId, baseUrl } }),
        });
        return (await r.json()) as unknown;
      };

      // Approve a repair plan → execute (sensitive actions stay gated by this approval).
      app.post<{ Params: { id: string }; Body: { action: string; baseUrl?: string } }>('/v1/repair-plans/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideRepairPlan', req, reply)) return reply;
        const action = req.body?.action ?? '';
        const map: Record<string, RepairPlan['status']> = { approve: 'approved', reject: 'rejected', request_changes: 'changes_requested' };
        const status = map[action];
        if (!status) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        const plan = await repairPlans.findOneAndUpdate({ repairPlanId: req.params.id }, { $set: { status, updatedAt: nowIso() } }, { returnDocument: 'after', projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'plan not found'));
        await ctx.publisher.publish({ type: EVENT_TYPES.APPROVAL_DECIDED, taskId: null, payload: { repairPlanId: plan.repairPlanId, status, message: `Repair plan ${status}` } });
        if (status === 'approved') {
          const result = await delegateExecuteRepair(plan.repairPlanId, req.body?.baseUrl);
          return reply.send(result);
        }
        return success({ plan });
      });

      // "Mark manual action done" / "re-run validation" → re-execute the plan.
      app.post<{ Params: { id: string }; Body: { baseUrl?: string } }>('/v1/incidents/:id/revalidate', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('revalidateIncident', req, reply)) return reply;
        const plan = await repairPlans.findOne({ incidentId: req.params.id }, { sort: { createdAt: -1 }, projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'no repair plan for incident'));
        const result = await delegateExecuteRepair(plan.repairPlanId, req.body?.baseUrl);
        return reply.send(result);
      });

      // --- Phase 7: Strategic Reasoning ----------------------------------
      app.get<{ Querystring: { taskId?: string } }>('/v1/strategic-plans', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await strategicPlans.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/strategic-plans/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const plan = await strategicPlans.findOne({ planId: req.params.id }, { projection: { _id: 0 } });
        if (!plan) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'plan not found'));
        const score = await planScores.findOne({ planId: plan.planId }, { projection: { _id: 0 } });
        return success({ plan, score });
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/plan-scores', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await planScores.find(f, { projection: { _id: 0 } }).sort({ total: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/policy-decisions', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await policyDecisions.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Querystring: { taskId?: string } }>('/v1/decision-memory', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const f = req.query.taskId ? { taskId: req.query.taskId } : {};
        return success(await decisionMemories.find(f, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray());
      });
      app.get<{ Params: { id: string } }>('/v1/llm-traces/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const t = await llmTraces.findOne({ traceId: req.params.id }, { projection: { _id: 0 } });
        if (!t) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'trace not found'));
        return success(t);
      });

}
