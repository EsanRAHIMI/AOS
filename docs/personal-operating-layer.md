# User Operating Layer

This is the next major product layer for AOS: turning the self-development
kernel into a real daily operating system for Esan first, then for many
permission-scoped users and roles.

## Goal

AOS should understand what matters to the current authorized user and tenant,
monitor the relevant world, propose the highest-value next actions, execute
safe steps, and ask for approval before risky, external, or public-impact actions.

Esan is the primary owner and platform governor. Future users may include team
members, operators, government officials, auditors, and citizens. Their data is
personalized and isolated; software capabilities evolve globally.

## Core Capabilities

| Capability | Description | First Safe Mode |
|---|---|---|
| User Profile | Goals, preferences, timezone, language, risk tolerance, constraints | manual entry + editable memory |
| Tenant Profile | Personal/team/company/government/citizen context and policies | admin-managed setup |
| Daily Briefing | Calendar/tasks/risks/opportunities/next actions | read-only summary |
| Weekly Strategy | Review progress, blocked items, opportunities, decisions | report + proposed task plan |
| Opportunity Engine | Income, job, project, SaaS, content, technology opportunities | research + scoring only |
| Scoped Research | News, markets, technology, immigration/education/business/civic topics | cited read-only research |
| Project Operating Layer | Track projects, milestones, blockers, evidence, next actions | task creation with approval |
| Brand/Resume Layer | CV, portfolio, GitHub, LinkedIn growth suggestions | draft-only output |
| Finance Awareness | Income/expense/runway signals | read-only ingestion first |
| Public-Service Case Layer | Government/citizen workflows, status, approvals, notices | read-only/case-draft first |

## Data Connectors

Start read-only and permission-scoped:

1. Calendar.
2. Email.
3. Drive/files/notes.
4. GitHub/projects.
5. Browser/bookmarks/research library.
6. Finance exports or API sources.
7. Government/department/citizen records, only after tenant policy and audit are ready.

Write actions require a separate phase with previews, approvals, audit logs,
and rollback where possible.

## Daily Loop

For each user/role, on the configured cadence:

1. Read current date/time/timezone.
2. Pull calendar/tasks/project status.
3. Check incidents, approvals, and blocked work.
4. Run fresh research for selected watch topics.
5. Score opportunities and risks.
6. Produce a short, scoped briefing:
   - top 3 priorities
   - schedule conflicts
   - one growth action
   - one income/opportunity action
   - pending approvals
   - what AOS can do next within this user's permissions

## Weekly Loop

Every week:

1. Compare planned vs actual progress.
2. Update goals, constraints, and preferences.
3. Review income/opportunity pipeline.
4. Review system health and cost.
5. Propose the next week's execution plan.
6. Ask the authorized decision-maker to approve, adjust, or reject.

## Scoring Model

Recommendations should include:

- Impact on the user's, tenant's, or public-service goals.
- Time required.
- Cost.
- Risk.
- Reversibility.
- Confidence and evidence quality.
- Deadline/urgency.
- Learning value.
- Privacy and policy impact.

## Product Standard

AOS should feel like a professional operator:

- concise
- proactive
- transparent
- evidence-backed
- approval-aware
- aware of the current user's preferences and role
- strict about tenant/user data boundaries
- unwilling to invent progress

## Implementation Order

1. `identity-and-tenant-service` for users, tenants, roles, and consent.
2. `personal-context-service` with editable user/tenant profiles.
3. Read-only calendar/email/drive connectors.
4. Daily briefing report.
5. Real web research provider.
6. Opportunity engine.
7. Weekly strategy review.
8. Public-service/citizen case model, read-only first.
9. Draft-only external outputs.
10. Approval-gated write actions.
