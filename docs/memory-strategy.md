# Memory & Learning Strategy

No fine-tuning yet. Build strong structured memory + skill extraction from day one.

## Memory types (`MemoryType`)
task, decision, architecture, error, solution, user_preference, service,
deployment, research, skill.

## After every major task the memory-agent produces
- What was done? What worked? What failed? What was learned?
- What can be reused? What should future agents know?
- What should be added to documentation?

These become compact `memories` (token-efficient summaries) and, when patterns
repeat successfully, promoted `skills` (`SkillSchema`: title, description,
steps, confidence).

## Training data capture
`agent_messages`, plans, tool calls, code changes, errors, fixes, reviews, human
approvals, task outcomes, and quality scores are persisted for future custom-model
datasets — without enabling fine-tuning prematurely.

## Token efficiency
Documentation + memory summaries exist so future agents understand the system
cheaply. Prefer reading a summary over re-deriving context.
