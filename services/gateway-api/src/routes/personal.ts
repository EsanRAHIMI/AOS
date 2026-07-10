/**
 * Gateway routes — personal group (K1.3 mechanical split).
 *
 * Bodies are moved VERBATIM from the pre-split server.ts; behavior is pinned
 * by the characterization suite. Shared runtime lives in GatewayDeps.
 */
import { COLLECTIONS, ERROR_CODES, ESAN_TENANT_ID, ESAN_USER_ID, EVENT_TYPES, INGESTION_KINDS, INTERNAL_TOKEN_HEADER, aggregateFinance, buildAccessDecision, buildDailyBrainPacket, buildDailyBriefingRun, buildEvidence, buildPersonalGraph, buildUniverseZones, buildWeeklyStrategyRun, canAccess, collection, composeDailyBriefing, detectLanguage, failure, genId, legacyRoleToAuthContext, nextConnectorFor, nowIso, pickActivePriorityFact, rankOpportunities, scopedCollection, scoreNextActions, stampScope, success } from '@factory/shared';
import type { AccessRequest, AuthContext, ConnectorAccount, ConnectorSyncRun, ConsentGrant, DailyBrainInput, IngestionKind, IngestionResult, OperatorRuntimeMemory, OperatorRuntimeSession, OperatorRuntimeStep, OperatorTool, OperatorToolPermission, OperatorToolRun, PersonalAsset, PersonalCareerRecord, PersonalFinanceItem, PersonalHealthState, PersonalIncomeStream, PersonalLearningTrack, PersonalLifeItem, PersonalProject, PersonalRisk, PersonalSystem, ScopedMemory, UserGoal } from '@factory/shared';
import type { FastifyInstance } from '@factory/service-kit';
import type { GatewayDeps, Req, FastifyReplyLike } from './deps.js';

export function registerPersonalRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const {
    env,
    ctx,
    guard,
    deny,
    clientIp,
    userAgent,
    declaredRole,
    writeAudit,
    writeSecEvent,
    isSafeMode,
    loadGraphInput,
    userStamp,
    gatherJarvisFacts,
    jarvisRouter,
    jarvisGov,
    tasks,
    approvals,
    events,
    proposals,
    skills,
    evidence,
    incidents,
    decisionMemories,
    operationPlans,
    evidenceCol,
    jarvisMemoryFacts,
    jarvisBriefings,
    tenantsCol,
    userProfiles,
    memberships,
    consentGrants,
    connectorAccounts,
    connectorSyncRuns,
    userGoals,
    dailyBriefings,
    opportunityReports,
    accessDecisions,
    realityProfiles,
    personalAssets,
    personalProjects,
    personalSystems,
    personalRisks,
    personalOpportunities,
    personalIncomeStreams,
    personalCareerRecords,
    resumeProfiles,
    nextBestActions,
    personalBriefingRuns,
    strategyReviewRuns,
    opTools,
    opToolRuns,
    opPermissions,
    opSessions,
    opSteps,
    opMemories,
  } = deps;

      const resolveAuth = (req: Req): AuthContext => legacyRoleToAuthContext(declaredRole(req));

      // K1.4b — scope-by-construction pilot (D-158). scoped_memories is the
      // first collection migrated off the raw GatewayDeps handle: every read/
      // write below is $and-merged with scopeFilter(actor,'user') by
      // scopedCollection itself, so a future edit to these handlers cannot
      // widen the query across users even by accident. Fail-closed on a
      // missing actor.primaryUserId (unreachable today — enforceScoped denies
      // first — but now structurally guaranteed, not just conventionally true).
      const memoriesFor = (actor: AuthContext) => scopedCollection<ScopedMemory>(COLLECTIONS.SCOPED_MEMORIES, { actor, scope: 'user' });

      // K1.4c — same pattern extended to the "personal facts" family (D-159):
      // the four collections behind /v1/me/universe's health/life/finance/
      // learning zones. All four already write via userStamp(actor) (scope:
      // 'user' stamped) and read via the shared uFilter shape, so this is a
      // mechanical swap of the collection reference, not a behavior change.
      const healthStatesFor = (actor: AuthContext) => scopedCollection<PersonalHealthState>(COLLECTIONS.PERSONAL_HEALTH_STATES, { actor, scope: 'user' });
      const lifeItemsFor = (actor: AuthContext) => scopedCollection<PersonalLifeItem>(COLLECTIONS.PERSONAL_LIFE_ITEMS, { actor, scope: 'user' });
      const financeItemsFor = (actor: AuthContext) => scopedCollection<PersonalFinanceItem>(COLLECTIONS.PERSONAL_FINANCE_ITEMS, { actor, scope: 'user' });
      const learningTracksFor = (actor: AuthContext) => scopedCollection<PersonalLearningTrack>(COLLECTIONS.PERSONAL_LEARNING_TRACKS, { actor, scope: 'user' });

      /** Enforce a scoped access request. Denials/approval-required are
       *  recorded (access_decisions + security event) and answered 403. */
      const enforceScoped = async (req: Req, reply: FastifyReplyLike, access: Omit<AccessRequest, 'actor'>): Promise<AuthContext | null> => {
        const actor = resolveAuth(req);
        const verdict = canAccess({ actor, ...access });
        if (!verdict.allowed) {
          await accessDecisions.insertOne(buildAccessDecision({ actor, ...access }, verdict));
          await writeSecEvent({ eventType: verdict.decision === 'approval_required' ? EVENT_TYPES.ACCESS_APPROVAL_REQUIRED : EVENT_TYPES.ACCESS_DENIED, actorId: actor.actorId, role: actor.roles[0] ?? 'unknown', ip: clientIp(req), userAgent: userAgent(req), target: access.resource, result: 'denied', riskLevel: 'medium', detail: verdict.reason });
          reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, verdict.reason, { decision: verdict.decision, requiredApproval: verdict.requiredApproval }));
          return null;
        }
        if (verdict.auditRequired) await accessDecisions.insertOne(buildAccessDecision({ actor, ...access }, verdict));
        return actor;
      };

      // --- personal operating layer (user scope, fail closed) -------------
      app.get('/v1/me/context', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'me_context', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const [profile, tenant, goals, consents, safe] = await Promise.all([
          userProfiles.findOne({ userId: actor.primaryUserId }, { projection: { _id: 0 } }),
          tenantsCol.findOne({ tenantId: actor.activeTenantId }, { projection: { _id: 0 } }),
          userGoals.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'active' }),
          consentGrants.countDocuments({ userId: actor.primaryUserId ?? '', status: 'active' }),
          isSafeMode(),
        ]);
        return success({
          actor: { actorId: actor.actorId, actorType: actor.actorType, displayName: profile?.displayName ?? 'Esan', roles: actor.roles, isOwner: actor.isOwner },
          tenant: tenant ? { tenantId: tenant.tenantId, name: tenant.name, kind: tenant.kind } : null,
          activeScope: 'user', safeMode: safe, activeGoals: goals, activeConsents: consents,
          governance: 'Global software evolution. Scoped human data.',
        });
      });
      app.get('/v1/me/profile', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'user_profile', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await userProfiles.findOne({ userId: actor.primaryUserId }, { projection: { _id: 0 } }));
      });
      app.patch<{ Body: { displayName?: string; locale?: string; timezone?: string; preferences?: Record<string, unknown> } }>('/v1/me/profile', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'user_profile', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const upd: Record<string, unknown> = { updatedAt: nowIso() };
        if (req.body?.displayName) upd.displayName = String(req.body.displayName).slice(0, 80);
        if (req.body?.locale) upd.locale = String(req.body.locale).slice(0, 10);
        if (req.body?.timezone) upd.timezone = String(req.body.timezone).slice(0, 60);
        if (req.body?.preferences) upd.preferences = req.body.preferences;
        await userProfiles.updateOne({ userId: actor.primaryUserId }, { $set: upd });
        return success({ updated: true });
      });
      app.get('/v1/me/goals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'user_goals', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await userGoals.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { title?: string; description?: string; horizon?: string; priority?: string } }>('/v1/me/goals', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'user_goals', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const title = String(req.body?.title ?? '').trim();
        if (!title) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'title is required'));
        const stamp = stampScope(actor, 'user');
        const goal: UserGoal = { ...stamp, goalId: genId('goal'), title: title.slice(0, 160), description: String(req.body?.description ?? '').slice(0, 1000), horizon: (['day', 'week', 'month', 'quarter', 'year', 'life'].includes(String(req.body?.horizon)) ? req.body?.horizon : 'week') as UserGoal['horizon'], status: 'active', priority: (['low', 'normal', 'high'].includes(String(req.body?.priority)) ? req.body?.priority : 'normal') as UserGoal['priority'], createdAt: nowIso(), updatedAt: nowIso() };
        await userGoals.insertOne(goal);
        return success(goal);
      });
      app.get('/v1/me/memories', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'scoped_memories', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await memoriesFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { kind?: string; content?: string } }>('/v1/me/memories', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'scoped_memories', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const content = String(req.body?.content ?? '').trim();
        if (!content) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'content is required'));
        const stamp = stampScope(actor, 'user');
        const mem: ScopedMemory = { ...stamp, memoryId: genId('smem'), kind: (['preference', 'fact', 'decision', 'workflow', 'mistake_avoidance', 'inference'].includes(String(req.body?.kind)) ? req.body?.kind : 'fact') as ScopedMemory['kind'], content: content.slice(0, 2000), source: 'user', confidence: 1, consentGrantId: null, createdAt: nowIso(), updatedAt: nowIso() };
        await memoriesFor(actor).insertOne(mem);
        await ctx.publisher.publish({ type: EVENT_TYPES.SCOPED_MEMORY_WRITTEN, taskId: null, payload: { scope: 'user', message: 'Private user memory written (content not included in event)' } });
        return success(mem);
      });
      app.get('/v1/me/briefings', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'daily_briefings', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await dailyBriefings.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(14).toArray());
      });
      app.get('/v1/me/opportunities', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'opportunity_reports', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await opportunityReports.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray());
      });
      app.get('/v1/tenants/current', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'read', resource: 'tenant', scope: 'tenant', tenantId: resolveAuth(req).activeTenantId ?? null });
        if (!actor) return reply;
        const [tenant, members] = await Promise.all([
          tenantsCol.findOne({ tenantId: actor.activeTenantId }, { projection: { _id: 0 } }),
          memberships.find({ tenantId: actor.activeTenantId ?? '' }, { projection: { _id: 0 } }).limit(50).toArray(),
        ]);
        return success({ tenant, members });
      });

      // --- consent & connector foundation (read-only, no secrets) ---------
      app.get('/v1/consents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await consentGrants.find({ userId: actor.primaryUserId ?? '' }, { projection: { _id: 0 } }).sort({ grantedAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { connectorType?: string; scopesAllowed?: string[] } }>('/v1/consents', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const connectorType = String(req.body?.connectorType ?? '').trim().slice(0, 40);
        if (!connectorType) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'connectorType is required'));
        // Phase AA: consent is READ-ONLY by design. Write modes come later,
        // behind preview + approval + audit + evidence.
        const grant: ConsentGrant = { grantId: genId('consent'), tenantId: actor.activeTenantId ?? ESAN_TENANT_ID, userId: actor.primaryUserId ?? ESAN_USER_ID, connectorType, scopesAllowed: (req.body?.scopesAllowed ?? []).map(String).slice(0, 20), accessMode: 'read_only', status: 'active', grantedAt: nowIso(), expiresAt: null, revokedAt: null, createdBy: actor.actorId, auditContext: { via: 'gateway' } };
        await consentGrants.insertOne(grant);
        await writeAudit({ actorType: 'human', actorId: actor.actorId, role: declaredRole(req), action: 'consent_granted', targetType: 'consent_grant', targetId: grant.grantId, after: { connectorType, accessMode: grant.accessMode } });
        await ctx.publisher.publish({ type: EVENT_TYPES.CONSENT_GRANTED, taskId: null, payload: { grantId: grant.grantId, connectorType, accessMode: grant.accessMode, message: `Read-only consent granted for ${connectorType}` } });
        return success(grant);
      });
      app.post<{ Params: { id: string } }>('/v1/consents/:id/revoke', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'consent_grants', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const grant = await consentGrants.findOne({ grantId: req.params.id, userId: actor.primaryUserId ?? '' });
        if (!grant) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'consent grant not found in your scope'));
        await consentGrants.updateOne({ grantId: grant.grantId }, { $set: { status: 'revoked', revokedAt: nowIso() } });
        await connectorAccounts.updateMany({ consentGrantId: grant.grantId }, { $set: { status: 'blocked', error: 'consent revoked', updatedAt: nowIso() } });
        await writeAudit({ actorType: 'human', actorId: actor.actorId, role: declaredRole(req), action: 'consent_revoked', targetType: 'consent_grant', targetId: grant.grantId });
        await ctx.publisher.publish({ type: EVENT_TYPES.CONSENT_REVOKED, taskId: null, payload: { grantId: grant.grantId, connectorType: grant.connectorType, message: `Consent revoked for ${grant.connectorType} — future syncs blocked` } });
        return success({ revoked: true });
      });
      app.get('/v1/connectors', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'list', resource: 'connector_accounts', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        return success(await connectorAccounts.find({ userId: actor.primaryUserId ?? '' }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      });
      app.post<{ Body: { connectorType?: string; provider?: string; consentGrantId?: string } }>('/v1/connectors', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const auth = resolveAuth(req);
        const grant = await consentGrants.findOne({ grantId: String(req.body?.consentGrantId ?? ''), userId: auth.primaryUserId ?? '' });
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'connector_accounts', scope: 'user', userId: auth.primaryUserId ?? null, requiresConsent: true, consentStatus: (grant?.status as 'active' | 'revoked' | 'expired' | undefined) ?? 'missing' });
        if (!actor) return reply;
        const account: ConnectorAccount = { connectorAccountId: genId('conn'), tenantId: actor.activeTenantId ?? ESAN_TENANT_ID, userId: actor.primaryUserId ?? ESAN_USER_ID, connectorType: String(req.body?.connectorType ?? grant?.connectorType ?? '').slice(0, 40), provider: String(req.body?.provider ?? '').slice(0, 40), status: 'pending', scopes: grant?.scopesAllowed ?? [], consentGrantId: grant?.grantId ?? '', lastSyncAt: null, error: '', metadata: {}, createdAt: nowIso(), updatedAt: nowIso() };
        await connectorAccounts.insertOne(account);
        return success(account);
      });
      app.post<{ Params: { id: string } }>('/v1/connectors/:id/sync', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const auth = resolveAuth(req);
        const account = await connectorAccounts.findOne({ connectorAccountId: req.params.id, userId: auth.primaryUserId ?? '' });
        if (!account) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'connector account not found in your scope'));
        const grant = await consentGrants.findOne({ grantId: account.consentGrantId });
        const consentActive = grant?.status === 'active';
        const run: ConnectorSyncRun = {
          syncRunId: genId('sync'), connectorAccountId: account.connectorAccountId, tenantId: account.tenantId, userId: account.userId,
          status: !consentActive ? 'blocked_no_consent' : 'not_configured',
          itemsRead: 0,
          detail: !consentActive ? `consent ${grant?.status ?? 'missing'} — sync refused` : `${account.connectorType} provider integration not configured yet (Phase AA is foundation-only; read-only sync arrives with the connector phase)`,
          startedAt: nowIso(), finishedAt: nowIso(),
        };
        await connectorSyncRuns.insertOne(run);
        if (!consentActive) {
          await ctx.publisher.publish({ type: EVENT_TYPES.CONNECTOR_SYNC_BLOCKED, taskId: null, payload: { connectorAccountId: account.connectorAccountId, message: `Sync blocked: consent ${grant?.status ?? 'missing'}`, level: 'warn' } });
          return reply.code(403).send(failure(ERROR_CODES.FORBIDDEN, 'consent is not active — sync blocked', { syncRunId: run.syncRunId }));
        }
        return success(run);
      });
      // === Phase AB — Personal Reality Baseline & Jarvis layer ============


      // Ingestion: manual/user-provided data with source + confidence stamped.
      app.post<{ Body: { kind?: string; data?: Record<string, unknown> } }>('/v1/me/reality/ingest', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'personal_reality', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const kind = String(req.body?.kind ?? '') as IngestionKind;
        if (!INGESTION_KINDS.includes(kind)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, `kind must be one of: ${INGESTION_KINDS.join(', ')}`));
        const d = req.body?.data ?? {};
        const stamp = userStamp(actor);
        const now = nowIso();
        const meta = { ...stamp, source: `ingestion:${kind}`, confidence: 0.9, freshness: now, createdAt: now, updatedAt: now };
        let created = 0, updated = 0;
        const str = (k: string, max = 500): string => String((d as Record<string, unknown>)[k] ?? '').slice(0, max);
        const arr = (k: string): string[] => (Array.isArray((d as Record<string, unknown>)[k]) ? ((d as Record<string, unknown>)[k] as unknown[]).map(String).slice(0, 40) : []);
        try {
          if (kind === 'profile') {
            const existing = await realityProfiles.findOne({ scope: 'user', userId: actor.primaryUserId });
            if (existing) { await realityProfiles.updateOne({ profileId: existing.profileId }, { $set: { displayName: str('displayName', 80) || existing.displayName, headline: str('headline', 200) || existing.headline, summary: str('summary', 2000) || existing.summary, location: str('location', 100) || existing.location, focusAreas: arr('focusAreas').length ? arr('focusAreas') : existing.focusAreas, strengths: arr('strengths').length ? arr('strengths') : existing.strengths, currentPosition: str('currentPosition', 200) || existing.currentPosition, incomeDirection: str('incomeDirection', 500) || existing.incomeDirection, scheduleDirection: str('scheduleDirection', 500) || existing.scheduleDirection, learningDirection: str('learningDirection', 500) || existing.learningDirection, freshness: now, updatedAt: now } }); updated++; }
            else { await realityProfiles.insertOne({ ...meta, recordKind: 'fact', profileId: genId('prof'), displayName: str('displayName', 80), headline: str('headline', 200), summary: str('summary', 2000), location: str('location', 100), focusAreas: arr('focusAreas'), strengths: arr('strengths'), currentPosition: str('currentPosition', 200), incomeDirection: str('incomeDirection', 500), scheduleDirection: str('scheduleDirection', 500), learningDirection: str('learningDirection', 500) }); created++; }
          } else if (kind === 'project') { await personalProjects.insertOne({ ...meta, recordKind: 'fact', projectId: genId('pproj'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), incomePotential: (['none', 'low', 'medium', 'high', 'unknown'].includes(str('incomePotential')) ? str('incomePotential') : 'unknown') as PersonalProject['incomePotential'], linkedGoalIds: arr('linkedGoalIds') }); created++; }
          else if (kind === 'system') { await personalSystems.insertOne({ ...meta, recordKind: 'fact', systemId: genId('psys'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), systemType: (['software', 'automation', 'process', 'habit', 'aos_service', 'other'].includes(str('systemType')) ? str('systemType') : 'other') as PersonalSystem['systemType'] }); created++; }
          else if (kind === 'asset') { await personalAssets.insertOne({ ...meta, recordKind: 'fact', assetId: genId('passet'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: arr('tags'), assetType: (['skill', 'software', 'content', 'audience', 'infrastructure', 'financial', 'credential', 'other'].includes(str('assetType')) ? str('assetType') : 'other') as PersonalAsset['assetType'] }); created++; }
          else if (kind === 'risk') { await personalRisks.insertOne({ ...meta, recordKind: 'fact', riskId: genId('prisk'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: [], severity: (['low', 'medium', 'high', 'critical'].includes(str('severity')) ? str('severity') : 'medium') as PersonalRisk['severity'], mitigation: str('mitigation', 500) }); created++; }
          else if (kind === 'income_idea') { await personalIncomeStreams.insertOne({ ...meta, recordKind: 'fact', incomeStreamId: genId('pinc'), title: str('title', 160), description: str('description', 2000), status: 'active', tags: [], streamType: (['salary', 'freelance', 'product', 'saas', 'content', 'investment', 'idea', 'other'].includes(str('streamType')) ? str('streamType') : 'idea') as PersonalIncomeStream['streamType'], monthlyEstimate: typeof (d as Record<string, unknown>).monthlyEstimate === 'number' ? (d as { monthlyEstimate: number }).monthlyEstimate : null }); created++; }
          else if (kind === 'goal') { const g = { ...userStamp(actor), goalId: genId('goal'), title: str('title', 160), description: str('description', 1000), horizon: 'week' as const, status: 'active' as const, priority: 'normal' as const, createdAt: now, updatedAt: now }; if (!g.title) throw new Error('title required'); await userGoals.insertOne(g); created++; }
          else if (kind === 'health_state') {
            const level = typeof (d as Record<string, unknown>).level === 'number' ? Math.max(0, Math.min(10, (d as { level: number }).level)) : null;
            await healthStatesFor(actor).insertOne({ ...meta, recordKind: 'fact', healthStateId: genId('phlth'), metric: (['wellbeing', 'energy', 'sleep', 'stress', 'weight', 'activity', 'nutrition', 'symptom', 'habit'].includes(str('metric')) ? str('metric') : 'wellbeing') as PersonalHealthState['metric'], level, value: str('value', 60), note: str('note', 400), concern: Boolean((d as Record<string, unknown>).concern) }); created++;
          }
          else if (kind === 'life_item') {
            await lifeItemsFor(actor).insertOne({ ...meta, recordKind: 'fact', lifeItemId: genId('plife'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), domain: (['family', 'home', 'relationship', 'household', 'personal'].includes(str('domain')) ? str('domain') : 'personal') as PersonalLifeItem['domain'], itemType: (['responsibility', 'concern', 'event', 'task', 'note'].includes(str('itemType')) ? str('itemType') : 'responsibility') as PersonalLifeItem['itemType'], dueDate: str('dueDate', 10) || null, importance: (['low', 'normal', 'high'].includes(str('importance')) ? str('importance') : 'normal') as PersonalLifeItem['importance'] }); created++;
          }
          else if (kind === 'finance_item') {
            await financeItemsFor(actor).insertOne({ ...meta, recordKind: 'fact', financeItemId: genId('pfin'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), itemType: (['income', 'expense', 'bill', 'installment', 'obligation', 'investment', 'purchase', 'sale'].includes(str('itemType')) ? str('itemType') : 'expense') as PersonalFinanceItem['itemType'], amount: typeof (d as Record<string, unknown>).amount === 'number' ? (d as { amount: number }).amount : null, currency: str('currency', 8), cadence: (['once', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(str('cadence')) ? str('cadence') : 'monthly') as PersonalFinanceItem['cadence'], dueDate: str('dueDate', 10) || null }); created++;
          }
          else if (kind === 'learning_track') {
            await learningTracksFor(actor).insertOne({ ...meta, recordKind: 'fact', learningTrackId: genId('plearn'), title: str('title', 160), description: str('description', 1000), status: 'active', tags: arr('tags'), targetSkill: str('targetSkill', 120), linkedGoalIds: arr('linkedGoalIds') }); created++;
          }
          else if (kind === 'career_record') { await personalCareerRecords.insertOne({ ...meta, recordKind: 'fact', careerRecordId: genId('pcar'), kind: (['experience', 'education', 'achievement', 'certification'].includes(str('recordType')) ? str('recordType') : 'experience') as PersonalCareerRecord['kind'], title: str('title', 160), organization: str('organization', 160), period: str('period', 60), details: str('details', 2000) }); created++; }
          else if (kind === 'resume') {
            const existing = await resumeProfiles.findOne({ scope: 'user', userId: actor.primaryUserId });
            const base = { rawText: str('rawText', 20000), skills: arr('skills'), freshness: now, updatedAt: now };
            if (existing) { await resumeProfiles.updateOne({ resumeProfileId: existing.resumeProfileId }, { $set: base }); updated++; }
            else { await resumeProfiles.insertOne({ ...meta, recordKind: 'fact', resumeProfileId: genId('presume'), ...base, positioning: '', verifiedFacts: [], userClaims: [], modelInferences: [], suggestions: [] }); created++; }
          } else { return reply.code(400).send(failure(ERROR_CODES.VALIDATION, `${kind} ingestion accepts only the documented fields`)); }
        } catch (e) { return reply.code(400).send(failure(ERROR_CODES.VALIDATION, e instanceof Error ? e.message : 'ingestion failed')); }
        const graph = buildPersonalGraph(await loadGraphInput(actor));
        const result: IngestionResult = { source: `ingestion:${kind}`, kind, recordsCreated: created, recordsUpdated: updated, confidence: 0.9, missingData: graph.missingData, nextSuggestedConnector: nextConnectorFor(kind) };
        const ev = buildEvidence({ type: 'health_check_result', taskId: null, serviceName: null, summary: `Personal ingestion ${kind}: +${created}/${updated} updated (user scope)`, data: { kind, created, updated } });
        await evidenceCol.insertOne(ev);
        // Phase AF.4 — real, minimal event so the dashboard's realtime block
        // store (and any other SSE consumer) can react to a personal-reality
        // mutation without polling. Carries the real ingestion kind so a
        // listener can map it to the affected Domain Canvas block(s).
        await ctx.publisher.publish({ type: EVENT_TYPES.REALITY_INGESTED, taskId: null, payload: { kind, created, updated, userId: actor.primaryUserId, message: `Reality ingested: ${kind} (+${created}/${updated})` } });
        return success({ ...result, evidenceId: ev.evidenceId });
      });

      const realityGet = (path: string, fetcher: (actor: AuthContext) => Promise<unknown>) => {
        app.get(path, async (req, reply) => {
          if (!guard(req)) return deny(reply);
          const actor = await enforceScoped(req, reply, { action: 'read', resource: path, scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
          if (!actor) return reply;
          return success(await fetcher(actor));
        });
      };
      realityGet('/v1/me/reality/profile', async (actor) => {
        const input = await loadGraphInput(actor);
        return { profile: input.profile, graph: buildPersonalGraph(input) };
      });
      realityGet('/v1/me/reality/goals', async (actor) => userGoals.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray());
      realityGet('/v1/me/reality/projects', async (actor) => ({
        projects: await personalProjects.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
        systems: await personalSystems.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
        assets: await personalAssets.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(100).toArray(),
      }));
      realityGet('/v1/me/reality/opportunities', async (actor) => rankOpportunities(await personalOpportunities.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(100).toArray()));
      realityGet('/v1/me/reality/risks', async (actor) => personalRisks.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray());
      realityGet('/v1/me/reality/next-actions', async (actor) => {
        const ranked = scoreNextActions(await loadGraphInput(actor), userStamp(actor));
        // Persist fresh proposals (idempotent enough: superseded ones expire).
        if (ranked.length) await nextBestActions.insertMany(ranked.map((a) => ({ ...a })));
        return ranked;
      });

      // Phase AC+ — THE Command Universe contract: one scope-enforced fetch
      // for the entire living home surface (9 zones, honest statuses).
      realityGet('/v1/me/universe', async (actor) => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [graph, health, life, finance, learning, nbas, briefing, connectors, svcCount, inc, op, activeSession, recentEvents, safe, memRecent] = await Promise.all([
          loadGraphInput(actor),
          healthStatesFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
          lifeItemsFor(actor).find({}, { projection: { _id: 0 } }).limit(100).toArray(),
          financeItemsFor(actor).find({}, { projection: { _id: 0 } }).limit(200).toArray(),
          learningTracksFor(actor).find({}, { projection: { _id: 0 } }).limit(50).toArray(),
          nextBestActions.find({ ...uFilter, status: 'proposed' }, { projection: { _id: 0 } }).sort({ priorityScore: -1 }).limit(10).toArray(),
          personalBriefingRuns.find(uFilter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray(),
          connectorAccounts.find({ userId: uid }, { projection: { _id: 0 } }).limit(50).toArray(),
          (async () => { try { const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(3000) }); const b = (await r.json()) as { data?: unknown[] }; return Array.isArray(b.data) ? b.data.length : 0; } catch { return 0; } })(),
          incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(),
          operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
          opSessions.find({ status: { $in: ['planning', 'running', 'waiting_approval', 'verifying'] } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).toArray(),
          events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(5).toArray(),
          isSafeMode(),
          memoriesFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(3).toArray(),
        ]);
        const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
        const openIncidentsList = inc.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
        const zones = buildUniverseZones({
          graph, healthStates: health, lifeItems: life, financeItems: finance,
          learningTracks: learning.map((t) => ({ title: t.title, targetSkill: t.targetSkill, status: t.status })),
          nextActions: nbas, latestBriefing: briefing[0] ?? null,
          kernel: {
            services: svcCount,
            openIncidents: openIncidentsList.length,
            pendingApprovals: graph.pendingApprovals, safeMode: safe,
            activeOperation: activeOp ? `${activeOp.goal} (${activeOp.status})` : null,
            activeRuntimeGoal: activeSession[0]?.goal ?? null,
            recentEvents: recentEvents.map((e) => (e.payload as { message?: string })?.message ?? e.type),
          },
          connectors: connectors.map((c) => ({ connectorType: c.connectorType, status: c.status })),
        });

        // Phase AD — Jarvis-suggested prompts + a one-line honest summary,
        // derived only from the real zones/facts above (attention first, then
        // setup-ready, then live) — never decorative, never invented.
        const priorityOrder: Record<string, number> = { attention: 0, setup_needed: 1, live: 2, not_configured: 3 };
        const suggestedPrompts = [...zones]
          .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9))
          .map((z) => z.jarvisCommand)
          .filter((c, i, arr) => c && arr.indexOf(c) === i)
          .slice(0, 4);
        const topAction = nbas[0];
        const todaySummary = topAction
          ? `Top priority: ${topAction.title}.${graph.pendingApprovals ? ` ${graph.pendingApprovals} approval(s) waiting.` : ''}${openIncidentsList.length ? ` ${openIncidentsList.length} open incident(s).` : ''}`
          : `No ranked priorities yet — build your baseline or tell Jarvis a goal.${graph.pendingApprovals ? ` ${graph.pendingApprovals} approval(s) waiting.` : ''}`;
        const systemHealthSummary = {
          servicesRegistered: svcCount,
          openIncidents: openIncidentsList.length,
          pendingApprovals: graph.pendingApprovals,
          safeMode: safe,
          activeOperation: activeOp ? `${activeOp.goal} (${activeOp.status})` : null,
        };
        const memoryInsights = memRecent.map((m) => m.content);

        return { zones, actor: { displayName: graph.profile?.displayName || 'Esan' }, generatedAt: nowIso(), suggestedPrompts, todaySummary, systemHealthSummary, memoryInsights };
      });

      // Phase AF.5 — dedicated per-domain routes. `/v1/me/universe` above
      // deliberately returns only sliced zone summaries (top 3-6 items) for
      // the homepage grid. The nine dedicated domain rooms (`/health`,
      // `/daily`, `/life`, `/finance`, `/ventures`, `/growth`,
      // `/opportunities`, `/systems`, `/presence`) need the FULL underlying
      // records so clicking "Open" on a zone leads somewhere real and
      // comprehensive instead of repeating the same 3-item summary. This
      // endpoint reuses the exact same scoped queries as `/v1/me/universe`
      // (same collections, same userId filter, same `buildUniverseZones()`
      // for the shared status/headline/metrics header) and additionally
      // returns the complete, unsliced per-domain arrays. One endpoint for
      // all nine domains — not nine separate ones — so every dedicated room
      // is guaranteed to read from the same real, consistent snapshot.
      realityGet('/v1/me/universe/detail', async (actor) => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [graph, health, life, finance, learning, nbas, allNbas, briefing, connectors, svcCount, incRaw, op, activeSession, recentEvents, safe] = await Promise.all([
          loadGraphInput(actor),
          healthStatesFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray(),
          lifeItemsFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray(),
          financeItemsFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(300).toArray(),
          learningTracksFor(actor).find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
          nextBestActions.find({ ...uFilter, status: 'proposed' }, { projection: { _id: 0 } }).sort({ priorityScore: -1 }).limit(10).toArray(),
          nextBestActions.find(uFilter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
          personalBriefingRuns.find(uFilter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(1).toArray(),
          connectorAccounts.find({ userId: uid }, { projection: { _id: 0 } }).limit(50).toArray(),
          (async () => { try { const r = await fetch(`${env.SERVICE_REGISTRY_URL}/services`, { headers: { [INTERNAL_TOKEN_HEADER]: env.FACTORY_INTERNAL_TOKEN }, signal: AbortSignal.timeout(3000) }); const b = (await r.json()) as { data?: unknown[] }; return Array.isArray(b.data) ? b.data.length : 0; } catch { return 0; } })(),
          incidents.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
          operationPlans.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(1).toArray(),
          opSessions.find({ status: { $in: ['planning', 'running', 'waiting_approval', 'verifying'] } }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(1).toArray(),
          events.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
          isSafeMode(),
        ]);
        const activeOp = op[0] && !['completed', 'failed', 'rolled_back', 'cancelled'].includes(op[0].status) ? op[0] : null;
        const openIncidentsList = incRaw.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
        const kernel = {
          services: svcCount,
          openIncidents: openIncidentsList.length,
          pendingApprovals: graph.pendingApprovals, safeMode: safe,
          activeOperation: activeOp ? `${activeOp.goal} (${activeOp.status})` : null,
          activeRuntimeGoal: activeSession[0]?.goal ?? null,
          recentEvents: recentEvents.map((e) => (e.payload as { message?: string })?.message ?? e.type),
        };
        const zones = buildUniverseZones({
          graph, healthStates: health, lifeItems: life, financeItems: finance,
          learningTracks: learning.map((t) => ({ title: t.title, targetSkill: t.targetSkill, status: t.status })),
          nextActions: nbas, latestBriefing: briefing[0] ?? null, kernel,
          connectors: connectors.map((c) => ({ connectorType: c.connectorType, status: c.status })),
        });
        return {
          zones, generatedAt: nowIso(),
          health: { states: health },
          life: { items: life },
          finance: { items: finance, aggregate: aggregateFinance(finance) },
          daily: { proposedActions: nbas, allActions: allNbas, latestBriefing: briefing[0] ?? null, pendingApprovals: graph.pendingApprovals },
          ventures: { projects: graph.projects },
          growth: { learningTracks: learning, goals: graph.goals },
          opportunities: { ranked: rankOpportunities(graph.opportunities.filter((o) => ['proposed', 'accepted', 'in_progress'].includes(o.status))) },
          systems: { kernel, openIncidents: openIncidentsList, recentEventsRaw: recentEvents.map((e) => ({ type: e.type, message: (e.payload as { message?: string })?.message ?? e.type, createdAt: e.createdAt })) },
          presence: { connectors: connectors.map((c) => ({ connectorType: c.connectorType, status: c.status, createdAt: c.createdAt })) },
        };
      });

      // Phase AE item 7 — the daily command briefing: ranked priorities across
      // kernel tasks + personal projects + next-best-actions, recent decisions,
      // active blockers, composed into one grounded narrative. Real records
      // only (same discipline as /v1/me/universe) — nothing here is invented.
      realityGet('/v1/jarvis/briefing', async (actor) => {
        const uid = actor.primaryUserId ?? '';
        const uFilter = { scope: 'user' as const, userId: uid };
        const [graph, activeTasks, activeProjects, recentDecisions, recentMemoryFacts, nbas, openIncidentsRaw, safe] = await Promise.all([
          loadGraphInput(actor),
          tasks.find({ status: { $in: ['queued', 'planning', 'awaiting_approval', 'in_progress', 'blocked'] } }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(20).toArray(),
          personalProjects.find({ ...uFilter, status: 'active' }, { projection: { _id: 0 } }).limit(20).toArray(),
          decisionMemories.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10).toArray(),
          jarvisMemoryFacts.find({ actorId: actor.actorId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(20).toArray(),
          nextBestActions.find({ ...uFilter, status: 'proposed' }, { projection: { _id: 0 } }).sort({ priorityScore: -1 }).limit(10).toArray(),
          incidents.find({}, { projection: { _id: 0 } }).limit(100).toArray(),
          isSafeMode(),
        ]);
        const openIncidentsList = openIncidentsRaw.filter((i) => i.status !== 'resolved' && i.status !== 'dismissed');
        const brainInput: DailyBrainInput = {
          actorName: graph.profile?.displayName || 'Esan',
          scope: 'user',
          activeTasks: activeTasks.map((t) => ({ taskId: t.taskId, goal: t.goal, status: t.status, priority: t.priority, createdAt: t.createdAt })),
          activeProjects: activeProjects.map((p) => ({ projectId: p.projectId, title: p.title, incomePotential: p.incomePotential, status: p.status })),
          pendingApprovals: graph.pendingApprovals,
          openIncidents: openIncidentsList.map((i) => ({ incidentId: i.incidentId, title: i.title, severity: i.severity })),
          personalRisks: (await personalRisks.find(uFilter, { projection: { _id: 0 } }).limit(50).toArray()).map((r) => ({ riskId: r.riskId, title: r.title, severity: r.severity, mitigation: r.mitigation })),
          recentDecisions: recentDecisions.map((d) => ({ decisionId: d.decisionId, goal: d.goal, selectedReason: d.selectedReason, createdAt: d.createdAt })),
          recentMemoryFacts: recentMemoryFacts.map((f) => ({ kind: f.kind, content: f.content, createdAt: f.createdAt })),
          nextBestActions: nbas.map((a) => ({ title: a.title, reason: a.reason, priorityScore: a.priorityScore })),
          safeMode: safe,
        };
        const packet = buildDailyBrainPacket(brainInput);
        const lang = detectLanguage(`${brainInput.activeTasks.map((t) => t.goal).join(' ')} ${recentMemoryFacts.map((f) => f.content).join(' ')}`);
        const forceFallback = safe && jarvisGov.safeModeFallback;
        const { data: briefing } = await composeDailyBriefing(jarvisRouter, { packet, language: lang, taskId: null, forceFallback });
        const record = {
          briefingId: genId('jbrief'), actorId: actor.actorId, scope: 'user' as const,
          headline: briefing.headline, narrative: briefing.narrative, topPriorities: briefing.topPriorities,
          decisions: briefing.decisions, blockers: briefing.blockers, suggestedFollowUps: briefing.suggestedFollowUps,
          language: briefing.language, createdAt: nowIso(),
        };
        await jarvisBriefings.insertOne(record);

        // Phase AE.1 — structured sections so the primary priority can never
        // be silently displaced by prioritizedItems (which ranks kernel
        // tasks/projects/actions, NOT explicit memory facts). An explicit,
        // recently-stated priority/decision memory fact always wins here,
        // exactly like the direct-answer path in gatherJarvisFacts.
        const priorityFact = pickActivePriorityFact(recentMemoryFacts);
        const primaryPriority = priorityFact?.content || packet.prioritizedItems[0]?.label || briefing.topPriorities[0] || '';
        const systemWarnings = openIncidentsList.map((i) => `${i.title} (${i.severity})`);
        const recommendedNextActions = briefing.suggestedFollowUps.length ? briefing.suggestedFollowUps : packet.prioritizedItems.slice(0, 3).map((p) => p.label);
        const memoryFactsUsed = recentMemoryFacts.slice(0, 10).map((f) => ({ kind: f.kind, content: f.content, importance: f.importance, createdAt: f.createdAt }));
        const confidence = priorityFact ? priorityFact.confidence : packet.prioritizedItems.length ? 0.5 : 0.3;

        return {
          ...record,
          primaryPriority,
          activeBlockers: packet.blockers,
          systemWarnings,
          recommendedNextActions,
          memoryFactsUsed,
          confidence,
          dataFreshness: packet.generatedAt,
          prioritizedItems: packet.prioritizedItems,
          generatedAt: packet.generatedAt,
        };
      });

      realityGet('/v1/me/reality/briefings', async (actor) => personalBriefingRuns.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(14).toArray());
      realityGet('/v1/me/reality/strategies', async (actor) => strategyReviewRuns.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray());
      realityGet('/v1/me/reality/resume', async (actor) => ({
        resume: await resumeProfiles.findOne({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }),
        careerRecords: await personalCareerRecords.find({ scope: 'user', userId: actor.primaryUserId }, { projection: { _id: 0 } }).limit(50).toArray(),
      }));

      app.post<{ Body: { type?: string } }>('/v1/me/reality/review', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'create', resource: 'personal_review', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const input = await loadGraphInput(actor);
        const sources = { calendar: input.activeConsents.includes('calendar'), email: input.activeConsents.includes('email'), tasksConnector: input.activeConsents.includes('tasks') };
        if (String(req.body?.type) === 'weekly') {
          const [completed, missed, newOpps] = await Promise.all([
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'completed' }),
            nextBestActions.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'expired' }),
            personalOpportunities.countDocuments({ scope: 'user', userId: actor.primaryUserId, status: 'proposed' }),
          ]);
          const run = buildWeeklyStrategyRun({ ...input, completedActions: completed, missedActions: missed, newOpportunities: newOpps }, userStamp(actor));
          await strategyReviewRuns.insertOne(run);
          return success(run);
        }
        const aosSuggestion = buildPersonalGraph(input).missingData.length > 0
          ? `AOS should build next: automated ingestion for “${buildPersonalGraph(input).missingData[0]}” — the biggest current intelligence gap.`
          : 'AOS should build next: the read-only calendar connector (first real external signal).';
        const run = buildDailyBriefingRun(input, sources, aosSuggestion, userStamp(actor));
        await personalBriefingRuns.insertOne(run);
        return success(run);
      });

      // Decisions on recommendations → scoped learning memory.
      app.post<{ Params: { id: string }; Body: { action?: string } }>('/v1/me/reality/next-actions/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'next_best_actions', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const act = String(req.body?.action ?? '');
        if (!['accept', 'reject', 'complete'].includes(act)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'action must be accept|reject|complete'));
        const nba = await nextBestActions.findOne({ actionId: req.params.id, scope: 'user', userId: actor.primaryUserId });
        if (!nba) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'action not found in your scope'));
        const status = act === 'accept' ? 'accepted' : act === 'reject' ? 'rejected' : 'completed';
        await nextBestActions.updateOne({ actionId: nba.actionId }, { $set: { status, updatedAt: nowIso() } });
        // Learn from the decision — scoped to the user, kind by outcome.
        const stamp = userStamp(actor);
        await memoriesFor(actor).insertOne({ ...stamp, memoryId: genId('smem'), kind: act === 'reject' ? 'mistake_avoidance' : 'decision', content: `${status.toUpperCase()}: “${nba.title}” (${nba.category}, score ${nba.priorityScore}). ${act === 'reject' ? 'Deprioritize similar suggestions.' : 'Similar suggestions are valuable.'}`, source: 'user_decision', confidence: 1, consentGrantId: null, createdAt: nowIso(), updatedAt: nowIso() });
        // Phase AF.4 — real mutation event (previously this endpoint published nothing).
        await ctx.publisher.publish({ type: EVENT_TYPES.NEXT_ACTION_DECIDED, taskId: null, payload: { actionId: nba.actionId, status, userId: actor.primaryUserId, message: `Next action ${status}: ${nba.title.slice(0, 80)}` } });
        return success({ status });
      });

      // Phase AF.3 — the Opportunity Radar zone could show real ranked
      // opportunities since AF.2 but had no way to act on one; this mirrors
      // the next-actions decision endpoint immediately above exactly (same
      // scope enforcement, same learn-from-decision memory write) rather
      // than inventing a new pattern for what is structurally the same kind
      // of "decide on a proposed record" operation.
      app.post<{ Params: { id: string }; Body: { action?: string } }>('/v1/me/reality/opportunities/:id/decision', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = await enforceScoped(req, reply, { action: 'update', resource: 'personal_opportunities', scope: 'user', userId: resolveAuth(req).primaryUserId ?? null });
        if (!actor) return reply;
        const act = String(req.body?.action ?? '');
        if (!['accept', 'reject', 'follow_up'].includes(act)) return reply.code(400).send(failure(ERROR_CODES.VALIDATION, 'action must be accept|reject|follow_up'));
        const opp = await personalOpportunities.findOne({ opportunityId: req.params.id, scope: 'user', userId: actor.primaryUserId });
        if (!opp) return reply.code(404).send(failure(ERROR_CODES.NOT_FOUND, 'opportunity not found in your scope'));
        const status = act === 'accept' ? 'accepted' : act === 'reject' ? 'rejected' : 'in_progress';
        await personalOpportunities.updateOne({ opportunityId: opp.opportunityId }, { $set: { status, updatedAt: nowIso() } });
        const stamp = userStamp(actor);
        await memoriesFor(actor).insertOne({ ...stamp, memoryId: genId('smem'), kind: act === 'reject' ? 'mistake_avoidance' : 'decision', content: `${status.toUpperCase()}: “${opp.title}” (${opp.category}, impact ${opp.impactScore}). ${act === 'reject' ? 'Deprioritize similar opportunities.' : 'Similar opportunities are valuable.'}`, source: 'user_decision', confidence: 1, consentGrantId: null, createdAt: nowIso(), updatedAt: nowIso() });
        // Phase AF.4 — real mutation event (previously this endpoint published nothing).
        await ctx.publisher.publish({ type: EVENT_TYPES.OPPORTUNITY_DECIDED, taskId: null, payload: { opportunityId: opp.opportunityId, status, userId: actor.primaryUserId, message: `Opportunity ${status}: ${opp.title.slice(0, 80)}` } });
        return success({ status });
      });

      app.get('/v1/access-decisions', async (req, reply) => {
        if (!guard(req)) return deny(reply);
        const actor = resolveAuth(req);
        // Owners/platform roles see the platform access log; others see their own decisions.
        const filter = actor.isOwner || actor.roles.includes('platform_admin') ? {} : { actorId: actor.actorId };
        return success(await accessDecisions.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray());
      });

      // === Phase X — Autonomous Operator Runtime =========================
      // The real agent loop: goal → plan → tools → observe → approve → verify
      // → evidence → memory. Raw model output never executes a tool; only the
      // deterministic planner and explicit human approvals do.

}
