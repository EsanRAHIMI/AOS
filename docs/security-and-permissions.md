# Security & Permissions

AOS is powerful only if it stays controllable. Security posture: observable,
approval-gated, least privilege, no hidden production changes.

## Hard Rules

- No blind destructive action.
- No secret exposure in logs, events, evidence, prompts, screenshots, or UI.
- No real-world external or public-impact action without approval.
- No deploy, rollback, env mutation, protected-core change, or data deletion without policy.
- No fake success when a provider, API, or permission is missing.
- Every important action creates audit/evidence/events.

## Current Controls

- `FACTORY_INTERNAL_TOKEN` for service-to-service calls.
- Dashboard/gateway privileged auth with signed server-side sessions.
- RBAC roles: owner, admin, operator, reviewer, viewer, agent; future tenant roles may include government_official, department_operator, citizen, auditor.
- Approval center for sensitive actions.
- Safe mode blocks mutation/deploy/repair/governance.
- Policy engine with allow/block/approval-required decisions.
- Audit logs and security events.
- Protected core checks for gateway, dashboard, and shared kernel.

## Data Isolation Rules

- Personal and institutional records must be scoped by `tenantId` and `userId` where applicable.
- Global kernel records are explicitly global: service manifests, deployments, schemas, docs, capabilities.
- A user can only read/write data allowed by role, tenant membership, consent, and policy.
- Cross-tenant analytics must use aggregation/anonymization unless explicitly approved.
- Citizen/public-service data must default to least privilege and audit-heavy access.

## Sensitive Action Classes

- Production deploy/restart/rollback/env mutation.
- GitHub branch/commit/PR/merge actions.
- Code changes to protected core.
- Data deletion, migration, restore, or bulk export.
- Sending email/messages or changing external accounts.
- Financial, identity, legal, or irreversible owner-impacting actions.
- Personal connector write actions.
- Government/public-service decisions, case updates, notifications, or citizen-facing outputs.

## Required Future Hardening

- OIDC/OAuth2 login and JWT/session revocation.
- Persistent per-user RBAC instead of env-only credentials.
- Tenant model with role inheritance, delegation, and consent records.
- Redis-backed rate limits, lockouts, sessions, and safe-mode propagation.
- Short-lived service identity tokens for internal calls.
- OpenTelemetry with trace ids attached to events/evidence.
- Secret scanning in CI and deployment env audits.
- Connector permission scopes: read-only first, write later with approval previews.

## Owner Interaction Rule

When AOS needs approval, it must explain:

1. What will happen.
2. Why it matters.
3. What data/source supports it.
4. What can go wrong.
5. How to undo or stop it.

For multi-user or public-service contexts, it must also state whose data,
tenant, department, or citizen case is affected.
