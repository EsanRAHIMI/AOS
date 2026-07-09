#!/usr/bin/env node
/**
 * Phase AG.1 smoke — Jarvis/operator research routing.
 *
 * Phase AG built a real Tavily-backed research fabric in
 * internet-research-service, but neither Jarvis-reachable tool actually
 * called it: `find_opportunities` carried a hardcoded "research provider is
 * not_configured" string, and `research_topic` only fired a fire-and-forget
 * kernel task with no grounded reply. This checks the deterministic,
 * network-free half of the fix — goal → tool routing and tool metadata —
 * from the real compiled shared/operator module. The synchronous HTTP
 * dispatch itself (dispatchResearch in gateway-api) requires a running
 * gateway + internet-research-service + Mongo and is exercised manually
 * (see docs/phase-log.md Phase AG.1 entry for the exact command).
 *
 * Run from repo root after building shared:
 *   node scripts/phaseag1-jarvis-research-routing-smoke.mjs
 */
import { buildOperatorToolRegistry, planForGoal } from '../shared/dist/operator/index.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase AG.1 — Jarvis research routing smoke\n');

const ctx = { safeMode: false, role: 'owner' };
const tools = buildOperatorToolRegistry({ dokployConfigured: true, codeWorkspaceConfigured: true, githubConfigured: true, voiceConfigured: true });

console.log('— Tool metadata is honest about the real path —');
const researchTool = tools.find((t) => t.toolId === 'research_topic');
check('research_topic is gateway_internal, not a fire-and-forget kernel_task', researchTool.executionPath === 'gateway_internal', researchTool.executionPath);
check('research_topic description mentions Tavily/sourceMode', /tavily|sourcemode/i.test(researchTool.description));
const oppTool = tools.find((t) => t.toolId === 'find_opportunities');
check('find_opportunities description mentions live research fallback', /research/i.test(oppTool.description) && !/not_configured/i.test(oppTool.description));

console.log('— Scenario: the exact reported-failing prompt —');
const p1 = planForGoal('Find current AI lighting design trends in Dubai luxury interiors', ctx);
check('Routes to research_topic (previously fell through to clarify)', p1.kind === 'single_tool' && p1.steps.some((s) => s.toolId === 'research_topic'));
check('Goal text is passed through as the research topic', p1.steps.find((s) => s.toolId === 'research_topic')?.args.goal === 'Find current AI lighting design trends in Dubai luxury interiors');

console.log('— Scenario: literal "research" phrasing still works —');
const p2 = planForGoal('research current Fastify best practices', ctx);
check('Routes to research_topic', p2.steps.some((s) => s.toolId === 'research_topic'));

console.log('— Scenario: "what\'s the latest on X" phrasing —');
const p3 = planForGoal("What's the latest on AI regulation in the EU?", ctx);
check('Routes to research_topic', p3.steps.some((s) => s.toolId === 'research_topic'));

console.log('— Scenario: personal "opportunities for me" still ranks DB first, with live fallback wired —');
const p4 = planForGoal('Find the best opportunities for me based on my goals and current assets.', ctx);
check('Routes to find_opportunities (not research_topic — DB ranking takes priority)', p4.steps.some((s) => s.toolId === 'find_opportunities'));
check('Goal text is passed through so a DB-empty fallback can research it live', p4.steps.find((s) => s.toolId === 'find_opportunities')?.args.goal?.length > 0);

console.log('— Regression: earlier, more specific patterns are not hijacked by the broadened research regex —');
const r1 = planForGoal('Check the whole system.', ctx);
check('Whole-system check still its own plan, not research', r1.steps[0].toolId === 'get_system_status');
const r2 = planForGoal('Restart the gateway.', ctx);
check('Restart still routes to risk classification, not research', r2.steps[0].toolId === 'classify_operation_risk');
const r3 = planForGoal('Find one thing wrong with your own operator UI and fix it', ctx);
check('UI self-fix still routes to workspace copy, not research', r3.steps[0].toolId === 'create_workspace');
const r4 = planForGoal('Create a small status-check service and deploy it.', ctx);
check('Service creation still routes to its own plan, not research', r4.steps[0].toolId === 'create_new_service_workspace');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
