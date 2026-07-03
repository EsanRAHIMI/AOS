#!/usr/bin/env node
/**
 * Phase X smoke — Autonomous Operator Runtime core logic.
 * Drives the real shared registry/planner/capability/failure modules (no
 * network, no DB). Run from repo root after building shared:
 *   node scripts/phasex-operator-runtime-smoke.mjs
 */
import {
  buildOperatorToolRegistry, buildCapabilityAnswer, planForGoal, isCapabilityQuestion,
  classifyToolFailure, OperatorToolSchema,
} from '../shared/dist/operator/index.js';
import { routeUtterance } from '../shared/dist/voice/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase X — operator runtime smoke\n');

const fullCtx = { dokployConfigured: true, codeWorkspaceConfigured: true, githubConfigured: true, voiceConfigured: true };
const bareCtx = { dokployConfigured: false, codeWorkspaceConfigured: false, githubConfigured: false, voiceConfigured: false };

console.log('— Tool registry —');
const tools = buildOperatorToolRegistry(fullCtx);
check('Registry has 40+ tools', tools.length >= 40, `got ${tools.length}`);
check('Every tool passes its schema', tools.every((t) => OperatorToolSchema.safeParse(t).success));
check('Every tool has a real execution path', tools.every((t) => ['gateway_internal', 'kernel_task', 'operation_plan', 'code_operator_agent', 'manual_required'].includes(t.executionPath)));
check('No unavailable tool pretends to be available', buildOperatorToolRegistry(bareCtx).filter((t) => ['inspect_repo', 'edit_code', 'test_dokploy_connection', 'create_pr'].includes(t.toolId)).every((t) => !t.available && t.unavailableReason.length > 0));
check('Mutating categories require approval or manual path', tools.filter((t) => ['deploy', 'repair'].includes(t.category)).every((t) => t.requiresApproval || t.executionPath === 'manual_required'));
check('Owner-only tools exist for critical control', tools.some((t) => t.ownerOnly && t.riskLevel === 'critical'));
check('Code tools carry rollback/evidence discipline', tools.find((t) => t.toolId === 'edit_code').evidenceRequired === true);

console.log('— Scenario A: what can you do? —');
check('Capability question detected', isCapabilityQuestion('What can you do?') && isCapabilityQuestion('list your tools'));
const cap = buildCapabilityAnswer(tools);
check('Answer is built from live registry (tool count appears)', cap.spoken.includes(`${tools.filter((t) => t.available).length} live tools`));
check('Answer is grouped by category with risk + approval labels', cap.groups.length >= 8 && cap.groups.every((g) => g.tools.every((t) => typeof t.riskLevel === 'string' && typeof t.requiresApproval === 'boolean')));
check('Answer includes concrete examples', /check the whole system|check gateway health/.test(cap.spoken));
check('Answer mentions owner approval for protected core', /owner approval/i.test(cap.spoken));
const capBare = buildCapabilityAnswer(buildOperatorToolRegistry(bareCtx));
check('Answer changes with configuration (dynamic, not hardcoded)', capBare.spoken !== cap.spoken);

console.log('— Scenario B: check the whole system —');
const b = planForGoal('Check the whole system.', { safeMode: false, role: 'operator' });
check('Creates a runtime plan', b.kind === 'runtime_goal' && b.steps.length >= 5);
check('Plan is strictly read-only tools', b.steps.every((s) => {
  const t = tools.find((x) => x.toolId === s.toolId);
  return t && t.riskLevel === 'low' && !t.requiresApproval && t.executionPath === 'gateway_internal';
}));
check('Plan ends with the evidence-storing aggregate check', b.steps[b.steps.length - 1].toolId === 'run_system_status_check');

console.log('— Scenario C: improve own code —');
const c = planForGoal('Find one thing wrong with your own operator UI and fix it', { safeMode: false, role: 'owner' });
check('Code plan (Phase Y): isolated workspace copy of dashboard-web → build → migration plan', c.kind === 'runtime_goal' && c.steps[0].toolId === 'create_workspace' && c.steps[0].args.sourceServiceId === 'dashboard-web' && c.steps[c.steps.length - 1].toolId === 'create_migration_plan');
check('propose is dry-run (low, no approval); edit requires approval', (() => {
  const propose = tools.find((t) => t.toolId === 'propose_code_change');
  const edit = tools.find((t) => t.toolId === 'edit_code');
  return propose.riskLevel === 'low' && !propose.requiresApproval && edit.requiresApproval;
})());

console.log('— Scenario D: create a small service —');
const d = planForGoal('Create a small status-check service and deploy it as a non-core app.', { safeMode: false, role: 'owner' });
check('Service plan (Phase Z): generate in workspace → auto-fix loop → migration plan', d.kind === 'runtime_goal' && d.steps[0].toolId === 'create_new_service_workspace' && d.steps.some((s) => s.toolId === 'run_workspace_tests') && d.steps[d.steps.length - 1].toolId === 'create_migration_plan');
check('create_new_service and create_operation_plan both require approval', ['create_new_service', 'create_operation_plan'].every((id) => tools.find((t) => t.toolId === id).requiresApproval));

console.log('— Scenario E: protected core safety —');
const e1 = planForGoal('Restart the gateway.', { safeMode: false, role: 'owner' });
check('Planner names protected core + owner approval in narration', /protected core/i.test(e1.narration) && /owner/i.test(e1.narration));
check('Plan routes through risk classification, never direct execution', e1.steps[0].toolId === 'classify_operation_risk' && !e1.steps.some((s) => s.toolId === 'execute_operation'));
const e2 = routeUtterance('Restart the gateway.', { role: 'owner', safeMode: false });
check('Voice mediation still blocks protected core (Phase 18 layer intact)', e2.blocked && e2.ownerOnly && e2.riskLevel === 'critical');

console.log('— Failure classification & self-improvement —');
const f1 = classifyToolFailure('inspect_repo', 'not_configured: CODE_WORKSPACE_ROOT is not set');
check('not_configured → cause + next action + mistake memory', f1.cause.length > 0 && f1.nextAction.length > 0 && f1.mistakeMemory !== null);
const f2 = classifyToolFailure('sync_dokploy_targets', 'fetch failed: ECONNREFUSED');
check('unreachable → suggests health check / repair path', /health check|repair/i.test(f2.nextAction));
const f3 = classifyToolFailure('edit_code', 'protected core: services/gateway-api/src/index.ts');
check('protected core failure → owner-visible path + mistake memory', /owner/i.test(f3.nextAction) && f3.mistakeMemory !== null);
const f4 = classifyToolFailure('create_operation_plan', 'Safe mode is ON — mutations are blocked.');
check('safe mode failure explains and points to Security', /safe mode/i.test(f4.cause));

console.log('— Clarify path (no capability spam) —');
const g = planForGoal('flibbertigibbet the mainframe', { safeMode: false, role: 'owner' });
check('Unknown goal → clarify with heard text, not a capability list', g.kind === 'clarify' && g.narration.includes('I heard:') && !/I can explain the current page/.test(g.narration));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
