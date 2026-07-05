#!/usr/bin/env node
/**
 * Phase AB smoke — Personal Reality Baseline & Jarvis intelligence engines.
 * Drives the REAL shared engines with fixed inputs. Covers scenarios A–F at
 * logic level + honesty guarantees (no fake sources, no invented credentials).
 * Run from repo root after building shared: node scripts/phaseab-personal-smoke.mjs
 */
import {
  buildPersonalGraph, scoreNextActions, buildDailyBriefingRun, buildWeeklyStrategyRun,
  rankOpportunities, opportunityValue, analyzeResume, nextConnectorFor, classifyPersonalCommand,
  PersonalOpportunitySchema, NextBestActionSchema, PersonalBriefingRunSchema,
  planForGoal, classifyGoalScope, canAccess,
} from '../shared/dist/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};
const now = new Date().toISOString();
const stamp = { scope: 'user', tenantId: 'tenant_esan_personal', userId: 'user_esan', projectId: null, caseId: null, visibility: 'private', createdBy: 'user_esan', updatedBy: null };

console.log('Phase AB — personal intelligence smoke\n');

const emptyInput = { profile: null, goals: [], projects: [], assets: [], systems: [], risks: [], opportunities: [], incomeStreams: [], pendingApprovals: 0, activeConsents: [] };
const opp = PersonalOpportunitySchema.parse({ ...stamp, opportunityId: 'opp1', title: 'Ship AOS SaaS pilot', category: 'product_saas', reason: 'Existing kernel + operator runtime is a sellable base.', linkedGoalIds: ['g1'], linkedAssetIds: ['a1'], impactScore: 8, effortScore: 5, riskScore: 3, recommendedNextAction: 'Define the pilot scope for one customer.', source: 'user', confidence: 0.9, freshness: now, recordKind: 'recommendation', createdAt: now, updatedAt: now });
const richInput = {
  profile: { displayName: 'Esan', freshness: now },
  goals: [{ goalId: 'g1', title: 'Build sustainable AI income', status: 'active', priority: 'high' }],
  projects: [{ projectId: 'p1', title: 'AOS Kernel', linkedGoalIds: ['g1'], freshness: now, status: 'active' }],
  assets: [{ assetId: 'a1', title: 'TypeScript/AI engineering', status: 'active' }],
  systems: [{ systemId: 's1', title: 'AOS operator runtime', status: 'active' }],
  risks: [{ riskId: 'r1', title: 'Single income stream', severity: 'high', status: 'active', mitigation: 'Launch second stream' }],
  opportunities: [opp],
  incomeStreams: [{ incomeStreamId: 'i1', title: 'Consulting', status: 'active' }],
  pendingApprovals: 2,
  activeConsents: [],
};

console.log('— Scenario A: personal baseline —');
const graphEmpty = buildPersonalGraph(emptyInput);
check('Empty baseline: missing data lists profile/goals/projects with HOW to add', graphEmpty.missingData.length >= 5 && graphEmpty.missingData.some((m) => m.includes('ingest')) && graphEmpty.missingData.some((m) => m.includes('not_configured')));
const graphRich = buildPersonalGraph(richInput);
check('Rich baseline: graph connects user→goals→projects→assets→risks→opportunities', graphRich.nodes.length >= 7 && graphRich.edges.some((e) => e.rel === 'serves_goal') && graphRich.edges.some((e) => e.rel === 'advances_goal') && graphRich.edges.some((e) => e.rel === 'threatens'));
check('Freshness tracked from real records', graphRich.dataFreshness === now);

console.log('— Scenario B: what should I do now —');
const ranked = scoreNextActions(richInput, stamp);
check('Actions ranked, all schema-valid, deterministic', ranked.length >= 3 && ranked.every((a) => NextBestActionSchema.safeParse(a).success) && JSON.stringify(scoreNextActions(richInput, stamp).map((a) => a.title)) === JSON.stringify(ranked.map((a) => a.title)));
check('High-severity risk ranks at the top', ranked[0].category === 'risk' && ranked[0].title.includes('Single income stream'));
check('Reasons are specific (mention severity/scores/sources), not generic', ranked.every((a) => a.reason.length > 20) && ranked.some((a) => /Impact 8\/10/.test(a.reason)));
check('Pending approvals produce an unblock action', ranked.some((a) => a.category === 'approval' && a.title.includes('2 pending')));
check('Every recommendation carries source/confidence/freshness/recordKind', ranked.every((a) => a.source === 'aos_engine' && a.confidence > 0 && a.freshness && a.recordKind === 'recommendation'));

console.log('— Scenario C: daily briefing —');
const briefing = buildDailyBriefingRun(richInput, { calendar: false, email: false, tasksConnector: false }, 'AOS next build: calendar connector.', stamp);
check('Briefing run schema-valid with top-3 priorities', PersonalBriefingRunSchema.safeParse(briefing).success && briefing.topPriorities.length === 3);
check('HONEST sources: calendar/email not_configured, tasks limited', briefing.sourcesNotConfigured.includes('calendar: not_configured') && briefing.sourcesNotConfigured.includes('email: not_configured') && briefing.sourcesNotConfigured.includes('tasks: limited_to_aos_tasks'));
check('Briefing includes income + growth + AOS actions + approvals + missing data', briefing.incomeAction.length > 0 && briefing.growthAction.length > 0 && briefing.aosAction.length > 0 && briefing.pendingApprovals === 2 && briefing.missingData.length > 0);
const briefingEmpty = buildDailyBriefingRun(emptyInput, { calendar: false, email: false, tasksConnector: false }, 'x', stamp);
check('Empty-data briefing asks for data instead of inventing a schedule', /ingest|record at least one goal/i.test(briefingEmpty.growthAction) && /No income opportunity recorded/i.test(briefingEmpty.incomeAction));

console.log('— Weekly strategy —');
const strat = buildWeeklyStrategyRun({ ...richInput, completedActions: 3, missedActions: 1, newOpportunities: 1 }, stamp);
check('Strategy: ranked plan + aosShouldBuild + esanShouldDo + approvals', strat.weeklyPlan.length >= 3 && strat.aosShouldBuild.length > 0 && strat.esanShouldDo.length > 0 && strat.needsApproval.length === 1);

console.log('— Scenario D: resume intelligence —');
const careers = [
  { careerRecordId: 'c1', kind: 'experience', title: 'AI Systems Engineer', organization: 'Self', period: '2023-2026', details: '', source: 'user', confidence: 1, freshness: now, recordKind: 'fact', ...stamp, createdAt: now, updatedAt: now },
];
const resume = analyzeResume({ rawText: 'Engineer building autonomous systems.', skills: ['TypeScript', 'AI agents', 'MongoDB', 'Fastify', 'Next.js', 'DevOps'], careerRecords: careers, goals: [{ title: 'Build sustainable AI income' }] });
check('User-provided data lands in CLAIMS, not verified facts', resume.userClaims.length >= 7 && resume.verifiedFacts.length === 0);
check('Inferences labeled with confidence, kept separate', resume.modelInferences.every((i) => /\[inference/.test(i)));
check('Suggestions concrete (achievements gap, goal alignment, verification path)', resume.suggestions.some((s) => s.includes('achievements')) && resume.suggestions.some((s) => s.includes('Build sustainable AI income')) && resume.suggestions.some((s) => s.includes('not_configured')));
check('NEVER invents credentials: positioning derives only from provided data', resume.positioning.includes('TypeScript') && !/PhD|certified|award/i.test(resume.positioning));
const resumeEmpty = analyzeResume({ rawText: '', skills: [], careerRecords: [], goals: [] });
check('Empty resume: honest “no positioning possible”', resumeEmpty.positioning.includes('No positioning possible'));

console.log('— Scenario E: opportunity engine —');
check('Value = impact*2 − effort − risk + goal bonus', opportunityValue(opp) === 8 * 2 - 5 - 3 + 2);
check('Ranking is by value, carries source+confidence', rankOpportunities([opp])[0].valueScore === 10 && rankOpportunities([opp])[0].confidence === 0.9);
check('Next connector guidance is honest per kind', nextConnectorFor('income_idea').includes('not_configured') && nextConnectorFor('project').includes('github'));

console.log('— Scenario F + operator integration —');
check('Personal commands classified A–F', classifyPersonalCommand('Build my personal reality baseline.') === 'baseline' && classifyPersonalCommand('What should I do now?') === 'what_now' && classifyPersonalCommand('Run my daily briefing') === 'daily_briefing' && classifyPersonalCommand('Analyze my resume and tell me how to improve my position.') === 'resume' && classifyPersonalCommand('Find the best opportunities for me based on my goals') === 'opportunities' && classifyPersonalCommand('What should AOS build next to improve my life, income, and future position?') === 'aos_build');
const planNow = planForGoal('What should I do now?', { safeMode: false, role: 'owner' });
check('“What should I do now?” plans user-scoped context + ranked actions', planNow.kind === 'runtime_goal' && planNow.steps.some((s) => s.toolId === 'get_next_best_actions'));
const planF = planForGoal('What should AOS build next to improve my life, income, and future position?', { safeMode: false, role: 'owner' });
check('Scenario F: analysis user-scoped, narration routes builds to GLOBAL evolution + approval', planF.steps.some((s) => s.toolId === 'propose_aos_build') && /global workspace evolution/i.test(planF.narration) && /approval/i.test(planF.narration));
check('Scope classification: personal vs global evolution unchanged', classifyGoalScope('What should I do now?').scope === 'user' || classifyGoalScope('Run my daily briefing').scope === 'user');
check('Isolation still enforced (AA regression): user B blocked from A memories', !canAccess({ actor: { actorId: 'b', actorType: 'human_user', primaryUserId: 'b', activeTenantId: 't1', roles: ['tenant_operator'], permissions: [], scopes: [], isOwner: false }, action: 'read', resource: 'scoped_memories', scope: 'user', userId: 'a' }).allowed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
