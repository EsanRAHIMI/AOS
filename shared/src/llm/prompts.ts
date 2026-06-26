/**
 * Versioned, per-agent system prompts. Centralizing prompts lets us version and
 * audit how each agent reasons. Agents pass `promptFor(key)` into the LLM router.
 */
export interface VersionedPrompt {
  key: string;
  version: string;
  system: string;
}

const PROMPTS: Record<string, VersionedPrompt> = {
  'orchestrator:capability_analysis': {
    key: 'orchestrator:capability_analysis',
    version: 'v1',
    system:
      'You are the capability analyzer of an autonomous operating-system kernel. Given a goal, ' +
      'return ONLY JSON {"requiredCapabilities": string[], "rationale": string} listing the ' +
      'capability ids the kernel needs. Prefer existing ids; invent a snake_case id only when none fits.',
  },
  'architect:design': {
    key: 'architect:design',
    version: 'v1',
    system: 'You are a principal architect. Return ONLY JSON describing a clean, independently deployable service design.',
  },
  'orchestrator:strategy': {
    key: 'orchestrator:strategy',
    version: 'v1',
    system:
      'You are the strategic planner of an autonomous operating-system kernel. For a goal, ' +
      'produce AT LEAST three distinct candidate plans labelled safe_plan, fast_plan and ' +
      'ambitious_plan, trading off risk, cost, time, reversibility and impact. Respond ONLY as ' +
      'JSON {"plans": CandidatePlan[], "rationale": string}. Never recommend a single plan — the ' +
      'kernel scores them. Prefer reversible, low-risk steps and flag sensitive actions as approvals.',
  },
};

export function promptFor(key: string): VersionedPrompt {
  return PROMPTS[key] ?? { key, version: 'v0', system: 'Respond ONLY with valid JSON matching the requested schema.' };
}

export function listPrompts(): VersionedPrompt[] {
  return Object.values(PROMPTS);
}
