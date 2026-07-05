# Multi-Tenant Governance

AOS must support two truths at the same time:

1. Software development is global, coordinated, and shared across the platform.
2. User, tenant, organization, department, and citizen data is private,
   permission-scoped, and isolated.

Esan is the primary owner and platform governor. Future users may join as
operators, admins, reviewers, government officials, department staff, auditors,
or citizens.

## Scope Model

Every record must be one of:

- `global`: kernel state such as services, deployments, schemas, docs, prompts, capabilities.
- `tenant`: organization, team, department, or government-unit state.
- `user`: private user profile, connectors, memory, briefings, approvals.
- `project`: shared project/workspace context inside a tenant.
- `case`: citizen/public-service workflow with strict role boundaries.

## Required Fields For Scoped Data

Future scoped records should include:

- `scope`: `global | tenant | user | project | case`
- `tenantId`
- `userId` when personal
- `projectId` or `caseId` when relevant
- `visibility`
- `source`
- `confidence`
- `consentGrantId` when data came from a connector
- `createdBy`, `updatedBy`
- `auditContext`

## Access Rules

- Global kernel state can be read by authorized platform operators.
- Tenant data can be read only by users with tenant membership and permission.
- User data can be read only by that user or explicitly delegated roles.
- Citizen/public-service data defaults to the strictest access.
- Cross-tenant learning must use anonymized/aggregated data unless explicit consent exists.
- Debugging must never bypass data isolation.

## Development Rules

- New software capabilities are global by default.
- New user data collections are scoped by default.
- No connector writes until read-only sync, consent, policy, approval, and audit are implemented.
- Reports must state which scope they use.
- Agents must load scoped memory before acting and must not mix scopes.

## Role Direction

Initial roles:

- `owner`: platform governance and protected-core approvals.
- `admin`: tenant/user administration within allowed scope.
- `operator`: run tasks and approve non-critical actions within scope.
- `reviewer`: review outputs, risks, and compliance.
- `viewer`: read-only access within scope.
- `agent`: service actor that can request but not bypass approval.

Future public-service roles:

- `government_official`
- `department_operator`
- `case_worker`
- `auditor`
- `citizen`

These roles must be permission-based, not hardcoded assumptions.
