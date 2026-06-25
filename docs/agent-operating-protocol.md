# Agent Operating Protocol

Every agent follows this loop. Agents must not rediscover the same information —
use documentation, memory, the registry, and prior decisions first.

1. Read relevant documentation (docs service / repo docs).
2. Read own service manifest.
3. Understand the task goal.
4. Check current architecture + contracts.
5. Pull memory summaries (memory-agent).
6. Create a clear plan.
7. Execute in small, traceable steps (one `agent_run`, many events).
8. Log every meaningful action.
9. Request approval when the action is sensitive/irreversible.
10. Update task status.
11. Update documentation.
12. Update memory.
13. Report outcome.

## Implementation hook
The shared agent skeleton (`templates/agent-service`) already records an
`agent_runs` document and emits `agent.run.started` / `agent.run.finished`.
Specialist logic replaces the planning block while keeping this trace intact.
