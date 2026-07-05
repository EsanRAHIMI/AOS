# Memory & Learning Strategy

Memory is AOS's long-term operating context. It must help future agents act
faster, ask fewer repeated questions, and align with the correct user, tenant,
role, and policy context.

## Current Memory Types

`task`, `decision`, `architecture`, `error`, `solution`, `user_preference`,
`service`, `deployment`, `research`, `skill`.

## Current Loop

After meaningful work, the system should record:

- What was done.
- What worked.
- What failed.
- What evidence exists.
- What future agents should reuse.
- What docs should change.

These become compact memories, skill candidates, reliability scores, patterns,
recommendations, and compressed contexts.

## Next Memory Layer: User and Tenant Context

Add durable, scoped memory:

- User profile: name style, timezone, languages, communication preference.
- Tenant profile: personal, team, company, government department, or public-service unit.
- Goals: personal, career, business, learning, finance, civic, organizational, project.
- Constraints: budget, time, risk tolerance, deadlines, commitments, legal/policy limits.
- Assets: resume, portfolio, GitHub, domains, products, documents, approved records.
- Preferences: decision style, notification style, approval thresholds.
- Relationships: contacts, organizations, departments, and cases, only with permission.

## Memory Quality Rules

- Never store secrets.
- Mark source and confidence.
- Separate facts, preferences, inferences, and temporary context.
- Allow user correction/deletion where policy permits.
- Scope every memory to `global`, `tenant`, `user`, `role`, `project`, or `case`.
- Summarize aggressively; keep raw logs only when useful for audit/evidence.
- Do not let stale memories silently override current authorized instructions.

## Future Learning Direction

- Daily briefings should write summary memory.
- Weekly strategy reviews should update goals and priorities.
- Opportunity analysis should record outcomes: accepted, rejected, profitable, failed.
- Public-service workflows should record case outcomes without leaking cross-user data.
- Prompt/model performance should drive provider and prompt recommendations.
- No fine-tuning until the dataset is clean, consented, deduplicated, and useful.
