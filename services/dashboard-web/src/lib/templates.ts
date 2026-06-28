/**
 * Real action templates. Each one maps to an actually-implemented kernel
 * pipeline; the `prompt` is the real goal text the orchestrator routes on.
 * Running a template creates a REAL task via the RBAC-gated createTaskAction —
 * there is no demo/simulation mode.
 */
export interface ActionTemplate {
  id: string;
  title: string;
  prompt: string;
  what: string;
  services: string[];
  outputs: string[];
  risk: 'low' | 'medium' | 'high';
  approval: boolean;
  resultsAt: string; // where to see results
  category: 'Operate' | 'Improve' | 'Intelligence' | 'Secure';
}

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    id: 'security-check', title: 'Run production security check',
    prompt: 'Run production security hardening check.',
    what: 'Audits env/secrets/tokens/session, safe mode and service protection, and stores a security check.',
    services: ['gateway-api'], outputs: ['Security check', 'Security event', 'Audit log'],
    risk: 'low', approval: false, resultsAt: '/security', category: 'Secure',
  },
  {
    id: 'research-plan', title: 'Research best practices & create an improvement plan',
    prompt: 'Research current best practices for securing autonomous agent dashboards and create an improvement plan.',
    what: 'Governed research with cited sources → evidence-grounded plan → review → QA → executive report.',
    services: ['internet-research-service', 'architect-agent', 'reviewer-agent', 'qa-agent', 'report-agent'],
    outputs: ['Research report', 'Improvement plan', 'Review', 'QA', 'Intelligence report', 'Evidence'],
    risk: 'low', approval: false, resultsAt: '/research', category: 'Intelligence',
  },
  {
    id: 'analyze-history', title: 'Analyze system history & recommend improvements',
    prompt: 'Analyze system history and recommend improvements.',
    what: 'Mines reliability, patterns and compressed memory from real history and produces evidence-backed recommendations.',
    services: ['orchestrator-agent', 'memory-agent'], outputs: ['Learning run', 'Reliability', 'Patterns', 'Recommendations'],
    risk: 'low', approval: false, resultsAt: '/learning', category: 'Improve',
  },
  {
    id: 'improvement-workflow', title: 'Turn the latest recommendation into an improvement workflow',
    prompt: 'Turn the latest learning recommendation into an improvement workflow and measure the result.',
    what: 'Converts an approved recommendation into a structured workflow, runs it through real engines, and measures impact.',
    services: ['orchestrator-agent'], outputs: ['Improvement workflow', 'Impact assessment', 'Evidence'],
    risk: 'medium', approval: true, resultsAt: '/improvement-workflows', category: 'Improve',
  },
  {
    id: 'reliability', title: 'Improve the reliability of browser-testing-agent',
    prompt: 'Improve the reliability of browser-testing-agent.',
    what: 'Reasons over multiple plans, scores them, checks policy, and selects with justification (sensitive steps gated).',
    services: ['orchestrator-agent'], outputs: ['Strategic plans', 'Policy decisions', 'Decision memory'],
    risk: 'medium', approval: true, resultsAt: '/reasoning', category: 'Improve',
  },
  {
    id: 'intel-report', title: 'Generate an operational intelligence report',
    prompt: 'Research the current state of the kernel and generate an executive intelligence report.',
    what: 'Synthesizes real system/research inputs into an executive report (grounded only in real data).',
    services: ['internet-research-service', 'report-agent'], outputs: ['Intelligence report', 'Evidence'],
    risk: 'low', approval: false, resultsAt: '/reports/center', category: 'Intelligence',
  },
];

export const TEMPLATES_BY_CATEGORY = (): Record<string, ActionTemplate[]> => {
  const out: Record<string, ActionTemplate[]> = {};
  for (const t of ACTION_TEMPLATES) (out[t.category] ??= []).push(t);
  return out;
};
