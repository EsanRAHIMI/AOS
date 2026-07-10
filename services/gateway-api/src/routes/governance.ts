/**
 * Gateway routes — governance group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { ERROR_CODES, EVENT_TYPES, INTERNAL_TOKEN_HEADER, buildScoringProfile, failure, genId, hasPermission, nowIso, peerUrl, success } from '@factory/shared';
import type { Task } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerGovernanceRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    ctx,
    guard,
    deny,
    declaredRole,
    writeAudit,
    enforce,
    tasks,
    proposals,
    evidence,
    outcomeReviews,
    scoringProfiles,
    scoringProposals,
    policyRules,
    policyProposals,
    rolesCol,
    permsCol,
    usersCol,
    auditLogs,
    learningRuns,
    reliabilityScores,
    operationalPatterns,
    memorySummaries,
    compressedContexts,
    systemRecommendations,
    promptPerformance,
    learningSchedules,
    learningTriggers,
    improvementWorkflows,
    impactAssessments,
    memoryMaintenanceRuns,
  } = deps;

      // --- Phase 8: Learning Governance & Adaptive Intelligence ----------
      // Actor role now comes from declaredRole() (admin+role header, or agent).
      const actorRole = declaredRole;

      app.get('/v1/outcome-reviews', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await outcomeReviews.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/scoring-profiles', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await scoringProfiles.find({}, { projection: { _id: 0 } }).sort({ version: -1 }).toArray()); });
      app.get('/v1/scoring-change-proposals', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await scoringProposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/policy-rules', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await policyRules.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()); });
      app.get('/v1/policy-change-proposals', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await policyProposals.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray()); });
      app.get('/v1/audit-logs', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await auditLogs.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(300).toArray()); });
      app.get('/v1/rbac', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const [roles, perms, users] = await Promise.all([
          rolesCol.find({}, { projection: { _id: 0 } }).toArray(),
          permsCol.find({}, { projection: { _id: 0 } }).toArray(),
          usersCol.find({}, { projection: { _id: 0 } }).toArray(),
        ]);
        return success({ roles, permissions: perms, users });
      });

      // Approve/reject a scoring change → versions a new active profile (RBAC + audit).
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/scoring-change-proposals/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideScoringProposal', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_scoring_change')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'scoring_change_denied', targetType: 'scoring_change_proposal', targetId: req.params.id, reason: 'RBAC: missing approve_scoring_change' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve scoring changes`));
        }
        const proposal = await scoringProposals.findOne({ proposalId: req.params.id });
        if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
        if (action !== 'approve') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await scoringProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status, approvedBy: role, decidedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `scoring_change_${status}`, targetType: 'scoring_change_proposal', targetId: proposal.proposalId, reason: 'preserve current profile' });
          return success({ proposal: { ...proposal, status } });
        }
        // Approve: create the next active profile version; archive the old one.
        const activeOld = await scoringProfiles.findOne({ status: 'active' as never });
        const nextVersion = (activeOld?.version ?? 1) + 1;
        if (activeOld) await scoringProfiles.updateOne({ profileId: activeOld.profileId }, { $set: { status: 'archived' } });
        const profile = buildScoringProfile(nextVersion, proposal.proposedWeights, { status: 'active', reason: proposal.reason, approvedBy: role });
        await scoringProfiles.insertOne(profile);
        await scoringProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status: 'approved', approvedBy: role, resultingProfileVersion: nextVersion, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'scoring_profile_changed', targetType: 'scoring_profile', targetId: profile.profileId, before: { version: activeOld?.version ?? null, weights: activeOld?.weights }, after: { version: nextVersion, weights: profile.weights }, reason: proposal.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.SCORING_PROFILE_ACTIVATED, taskId: null, payload: { version: nextVersion, message: `Scoring profile v${nextVersion} active` } });
        return success({ activated: true, profileVersion: nextVersion, profile });
      });

      // Approve/reject a policy change → activates a configurable rule (RBAC + audit).
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/policy-change-proposals/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decidePolicyProposal', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_policy_change')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'policy_change_denied', targetType: 'policy_change_proposal', targetId: req.params.id, reason: 'RBAC: missing approve_policy_change' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve policy changes`));
        }
        const proposal = await policyProposals.findOne({ proposalId: req.params.id });
        if (!proposal) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'proposal not found'));
        if (action !== 'approve') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await policyProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status, approvedBy: role, decidedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `policy_change_${status}`, targetType: 'policy_change_proposal', targetId: proposal.proposalId });
          return success({ proposal: { ...proposal, status } });
        }
        await policyRules.insertOne({ ...proposal.rule, status: 'active' });
        await policyProposals.updateOne({ proposalId: proposal.proposalId }, { $set: { status: 'approved', approvedBy: role, decidedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'policy_rule_changed', targetType: 'policy_rule', targetId: proposal.rule.ruleId, after: proposal.rule, reason: proposal.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.POLICY_PROFILE_ACTIVATED, taskId: null, payload: { ruleId: proposal.rule.ruleId, message: 'Policy rule activated' } });
        return success({ activated: true, rule: proposal.rule });
      });

      // --- Phase 9: Operational Learning & Memory Intelligence -----------
      app.get('/v1/learning-runs', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });
      app.get('/v1/reliability', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await reliabilityScores.find({}, { projection: { _id: 0 } }).sort({ lastUpdatedAt: -1 }).limit(300).toArray()); });
      app.get('/v1/patterns', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await operationalPatterns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/memory-summaries', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await memorySummaries.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/compressed-contexts', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await compressedContexts.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray()); });
      app.get('/v1/system-recommendations', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await systemRecommendations.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/prompt-performance', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await promptPerformance.find({}, { projection: { _id: 0 } }).sort({ lastUpdatedAt: -1 }).limit(100).toArray()); });

      // Approve/convert a system recommendation (RBAC + audit). Approving converts it to a task.
      app.post<{ Params: { id: string }; Body: { action: string } }>('/v1/system-recommendations/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('decideRecommendation', req, reply)) return reply;
        const role = actorRole(req);
        const action = req.body?.action ?? '';
        if (!['approve', 'convert_to_task', 'convert_to_workflow', 'reject', 'request_changes'].includes(action)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'invalid action'));
        if (!hasPermission(role, 'approve_recommendation')) {
          await writeAudit({ actorType: role === 'agent' ? 'agent' : 'human', actorId: role, role, action: 'recommendation_denied', targetType: 'system_recommendation', targetId: req.params.id, reason: 'RBAC: missing approve_recommendation' });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, `role ${role} cannot approve recommendations`));
        }
        const rec = await systemRecommendations.findOne({ recommendationId: req.params.id });
        if (!rec) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'recommendation not found'));
        if (action === 'reject' || action === 'request_changes') {
          const status = action === 'reject' ? 'rejected' : 'changes_requested';
          await systemRecommendations.updateOne({ recommendationId: rec.recommendationId }, { $set: { status, updatedAt: nowIso() } });
          await writeAudit({ actorType: 'human', actorId: role, role, action: `recommendation_${status}`, targetType: 'system_recommendation', targetId: rec.recommendationId });
          await ctx.publisher.publish({ type: EVENT_TYPES.RECOMMENDATION_DECIDED, taskId: null, payload: { recommendationId: rec.recommendationId, status } });
          return success({ recommendation: { ...rec, status } });
        }
        // Approve / convert → mark approved, then run the improvement workflow
        // pipeline (convert → execute → impact) via the orchestrator.
        const now = nowIso();
        await systemRecommendations.updateOne({ recommendationId: rec.recommendationId }, { $set: { status: 'approved', updatedAt: now } });
        const newTask: Task = { taskId: genId('task'), goal: 'Turn the latest learning recommendation into an improvement workflow and measure the result', status: 'queued', priority: 'normal', createdBy: 'gateway-api', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags: ['improvement', rec.type], error: null, createdAt: now, updatedAt: now };
        await tasks.insertOne(newTask);
        await writeAudit({ actorType: 'human', actorId: role, role, action: 'recommendation_approved', targetType: 'system_recommendation', targetId: rec.recommendationId, after: { taskId: newTask.taskId, type: rec.type }, reason: rec.reason });
        await ctx.publisher.publish({ type: EVENT_TYPES.RECOMMENDATION_DECIDED, taskId: newTask.taskId, payload: { recommendationId: rec.recommendationId, status: 'approved', taskId: newTask.taskId, message: `Recommendation approved → improvement workflow` } });
        await ctx.publisher.publish({ type: EVENT_TYPES.TASK_CREATED, taskId: newTask.taskId, payload: { goal: newTask.goal } });
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        try {
          await fetch(`${orchestratorUrl}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ taskId: newTask.taskId, goal: newTask.goal, input: { recommendationId: rec.recommendationId } }) });
          await tasks.updateOne({ taskId: newTask.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch (e) { ctx.log.warn({ err: e }, 'improvement task forward failed'); }
        return success({ approved: true, taskId: newTask.taskId });
      });

      // --- Phase 10 reads + learning trigger -----------------------------
      app.get('/v1/learning/schedules', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningSchedules.find({}, { projection: { _id: 0 } }).toArray()); });
      app.get('/v1/learning/triggers', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await learningTriggers.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });
      app.get('/v1/improvement-workflows', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await improvementWorkflows.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get<{ Params: { id: string } }>('/v1/improvement-workflows/:id', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const wf = await improvementWorkflows.findOne({ workflowId: req.params.id }, { projection: { _id: 0 } });
        if (!wf) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'workflow not found'));
        const impact = wf.impactAssessmentId ? await impactAssessments.findOne({ impactAssessmentId: wf.impactAssessmentId }, { projection: { _id: 0 } }) : null;
        const ev = await evidence.find({ evidenceId: { $in: wf.evidenceIds } as never }, { projection: { _id: 0 } }).toArray();
        return success({ workflow: wf, impact, evidence: ev });
      });
      app.get('/v1/impact-assessments', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await impactAssessments.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray()); });
      app.get('/v1/memory-maintenance', async (req, reply) => { if (!guard(req)) return deny(reply); return success(await memoryMaintenanceRuns.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()); });

      // Trigger a learning run now (manual trigger; the model supports continuous use).
      app.post<{ Body: { type?: string; reason?: string } }>('/v1/learning/trigger', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        if (await enforce('triggerLearning', req, reply)) return reply;
        const now = nowIso();
        const trig = { triggerId: genId('trig'), scheduleId: null, type: (req.body?.type ?? 'manual'), reason: req.body?.reason ?? 'manual trigger from dashboard', newRecords: 0, dispatchedTaskId: null as string | null, createdAt: now };
        const learnTask: Task = { taskId: genId('task'), goal: 'Analyze system history and recommend improvements', status: 'queued', priority: 'normal', createdBy: 'gateway-api', assignedServiceId: null, parentTaskId: null, requiresApproval: false, tags: ['learning', 'triggered'], error: null, createdAt: now, updatedAt: now };
        await tasks.insertOne(learnTask);
        trig.dispatchedTaskId = learnTask.taskId;
        await learningTriggers.insertOne(trig as never);
        await ctx.publisher.publish({ type: EVENT_TYPES.LEARNING_TRIGGERED, taskId: learnTask.taskId, payload: { triggerId: trig.triggerId, message: 'Learning run triggered' } });
        const orchestrator = await ctx.registry.resolve('orchestrator-agent');
        const orchestratorUrl = orchestrator?.domain ?? peerUrl('orchestrator-agent');
        try {
          await fetch(`${orchestratorUrl}/.factory/task`, { method: 'POST', headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, body: JSON.stringify({ taskId: learnTask.taskId, goal: learnTask.goal, input: {} }) });
          await tasks.updateOne({ taskId: learnTask.taskId }, { $set: { assignedServiceId: 'orchestrator-agent', status: 'planning', updatedAt: nowIso() } });
        } catch (e) { ctx.log.warn({ err: e }, 'learning trigger forward failed'); }
        return success({ triggered: true, taskId: learnTask.taskId });
      });
      app.post<{ Params: { id: string } }>('/v1/learning/schedules/:id/toggle', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const sc = await learningSchedules.findOne({ scheduleId: req.params.id });
        if (!sc) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'schedule not found'));
        await learningSchedules.updateOne({ scheduleId: sc.scheduleId }, { $set: { enabled: !sc.enabled, updatedAt: nowIso() } });
        return success({ scheduleId: sc.scheduleId, enabled: !sc.enabled });
      });

}
