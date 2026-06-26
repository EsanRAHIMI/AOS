/**
 * Strategic Planner (Phase 7). Generates multiple candidate plans (safe / fast /
 * ambitious) for a goal via the LLM router with schema-validated output, falling
 * back to deterministic strategy templates when no provider is configured. The
 * planner never returns a single plan — choice is the scorer's job.
 */
import type { LlmRouter } from '../llm/index.js';
import { promptFor } from '../llm/prompts.js';
import { CandidatePlansSchema, type CandidatePlan, type CandidatePlans } from '../schemas/reasoning.js';
import type { LlmTrace } from '../schemas/capability.js';

export interface PlannerArgs {
  goal: string;
  router: LlmRouter;
  agentId: string;
  taskId: string;
  /** The service the goal targets, if any (used by deterministic templates). */
  serviceName?: string;
}

export interface PlannerResult {
  plans: CandidatePlan[];
  rationale: string;
  trace: LlmTrace;
}

/** Deterministic safe/fast/ambitious plans — also the validated fallback. */
export function deterministicPlans(goal: string, serviceName = 'browser-testing-agent'): CandidatePlans {
  const reliability = /reliab|improve|harden|stabil|quality/i.test(goal);
  if (reliability) {
    return {
      rationale: 'deterministic reliability-improvement templates',
      plans: [
        {
          label: 'safe_plan',
          title: `Harden ${serviceName} validation & fallback reporting`,
          steps: [`Run runtime validation on ${serviceName}`, 'Improve HTTP-fallback reporting with structured notes', 'Re-run the live activation check', 'Record evidence'],
          requiredCapabilities: ['browser_testing'],
          servicesInvolved: ['builder-agent', 'monitor-agent'],
          toolsInvolved: [],
          requiredApprovals: [],
          expectedCostUsd: 0,
          expectedTimeMinutes: 8,
          riskLevel: 'low',
          reversibility: 0.95,
          confidence: 0.82,
          expectedImpact: 'Higher reliability with minimal risk; no production mutation.',
          failureModes: ['Validation flakiness'],
          validationPlan: 'Run runtime validation, then the live activation check.',
        },
        {
          label: 'fast_plan',
          title: `Patch ${serviceName} timeout/retry directly`,
          steps: [`Patch ${serviceName} (timeout + retry on goto)`, 'Open a GitHub PR', 'Redeploy', 'Validate'],
          requiredCapabilities: ['browser_testing', 'cap_service_generation'],
          servicesInvolved: ['builder-agent', 'devops-agent'],
          toolsInvolved: ['GitHub'],
          requiredApprovals: ['create_pr', 'redeploy'],
          expectedCostUsd: 0.02,
          expectedTimeMinutes: 20,
          riskLevel: 'medium',
          reversibility: 0.7,
          confidence: 0.6,
          expectedImpact: 'Targeted fix; moderate risk of regressions.',
          failureModes: ['Patch regressions', 'Redeploy downtime'],
          validationPlan: 'Validate the patched build, then re-run activation.',
        },
        {
          label: 'ambitious_plan',
          title: `Full Playwright runtime + screenshots + CI for ${serviceName}`,
          steps: ['Add playwright-core + browser install', 'Add screenshot/report pipeline to S3', 'Add CI checks', 'Patch + PR', 'Redeploy', 'Validate'],
          requiredCapabilities: ['browser_testing', 'cap_service_generation', 'cap_file_storage'],
          servicesInvolved: ['builder-agent', 'devops-agent', 'monitor-agent', 'file-asset-service'],
          toolsInvolved: ['Playwright', 'GitHub', 'CI'],
          requiredApprovals: ['create_pr', 'redeploy', 'change_env'],
          expectedCostUsd: 0.1,
          expectedTimeMinutes: 60,
          riskLevel: 'high',
          reversibility: 0.5,
          confidence: 0.55,
          expectedImpact: 'Highest capability uplift; high effort and risk.',
          failureModes: ['Browser binary unavailable', 'CI flakiness', 'Larger blast radius'],
          validationPlan: 'Full validation + activation + browser test with screenshot evidence.',
        },
      ],
    };
  }
  // Generic 3-plan template for any goal.
  return {
    rationale: 'deterministic generic strategy templates',
    plans: [
      { label: 'safe_plan', title: `Minimal, reversible approach to: ${goal}`, steps: ['Analyze current state', 'Apply the smallest reversible change', 'Validate', 'Record evidence'], requiredCapabilities: [], servicesInvolved: ['builder-agent', 'monitor-agent'], toolsInvolved: [], requiredApprovals: [], expectedCostUsd: 0, expectedTimeMinutes: 10, riskLevel: 'low', reversibility: 0.95, confidence: 0.75, expectedImpact: 'Low-risk incremental progress.', failureModes: ['Insufficient scope'], validationPlan: 'Runtime validation + activation check.' },
      { label: 'fast_plan', title: `Direct change to: ${goal}`, steps: ['Make the change', 'Open PR', 'Deploy', 'Validate'], requiredCapabilities: ['cap_service_generation'], servicesInvolved: ['builder-agent', 'devops-agent'], toolsInvolved: ['GitHub'], requiredApprovals: ['create_pr', 'redeploy'], expectedCostUsd: 0.02, expectedTimeMinutes: 25, riskLevel: 'medium', reversibility: 0.7, confidence: 0.6, expectedImpact: 'Faster but riskier.', failureModes: ['Regressions'], validationPlan: 'Validate + activation.' },
      { label: 'ambitious_plan', title: `Comprehensive solution to: ${goal}`, steps: ['Design', 'Build new service/feature', 'Infra + CI', 'PR + deploy', 'Validate'], requiredCapabilities: ['cap_service_generation', 'cap_infrastructure_request'], servicesInvolved: ['architect-agent', 'builder-agent', 'devops-agent', 'monitor-agent'], toolsInvolved: ['GitHub', 'CI'], requiredApprovals: ['create_pr', 'redeploy', 'change_env'], expectedCostUsd: 0.1, expectedTimeMinutes: 90, riskLevel: 'high', reversibility: 0.5, confidence: 0.5, expectedImpact: 'Largest uplift; highest risk/effort.', failureModes: ['Scope creep', 'Larger blast radius'], validationPlan: 'Full validation + activation + evidence.' },
    ],
  };
}

export async function generateCandidatePlans(args: PlannerArgs): Promise<PlannerResult> {
  const prompt = promptFor('orchestrator:strategy');
  const { data, trace } = await args.router.generateStructured(CandidatePlansSchema, {
    agentId: args.agentId,
    taskType: 'strategic_planning',
    taskId: args.taskId,
    promptVersion: prompt.version,
    system: prompt.system,
    prompt: `Goal: ${args.goal}\nTarget service: ${args.serviceName ?? 'n/a'}\nReturn at least 3 candidate plans labelled safe_plan, fast_plan, ambitious_plan as JSON {"plans": [...], "rationale": "..."}.`,
    fallback: () => deterministicPlans(args.goal, args.serviceName),
  });
  return { plans: data.plans, rationale: data.rationale, trace };
}
