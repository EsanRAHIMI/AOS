import { z } from 'zod';

/* ===========================================================================
 * Phase AA — Scope model. THE rule of the platform:
 *   Global software evolution. Scoped human data.
 * Kernel state (services, capabilities, prompts, schemas, deployments, docs,
 * self-development) is scope:'global' and centrally governed. User, tenant,
 * project and case data is private, permission-controlled and isolated.
 * Every record is either explicitly global or carries scope metadata —
 * no silent unscoped user data, no cross-user/tenant/case leakage.
 * ======================================================================== */

export const Scope = z.enum(['global', 'tenant', 'user', 'project', 'case']);
export type Scope = z.infer<typeof Scope>;

export const Visibility = z.enum(['private', 'tenant', 'role', 'public', 'restricted']);
export type Visibility = z.infer<typeof Visibility>;

/** Optional scope metadata merged into existing kernel schemas without
 *  breaking their current writers. Read convention: a record WITHOUT a scope
 *  field is legacy kernel data and is treated as scope:'global' (the
 *  migration script stamps this explicitly). NEW scoped writers must always
 *  stamp these fields — helpers in shared/src/scope enforce fail-closed. */
export const ScopeFieldsSchema = z.object({
  scope: Scope.optional(),
  // nullish: Mongo writers often persist explicit null for unused scope keys
  // (e.g. CIN genesis entities with scope:'user' and tenantId:null).
  tenantId: z.string().nullish(),
  userId: z.string().nullish(),
  projectId: z.string().nullish(),
  caseId: z.string().nullish(),
  visibility: Visibility.optional(),
  source: z.string().optional(),
  confidence: z.number().optional(),
  consentGrantId: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().nullish(),
  auditContext: z.record(z.string(), z.unknown()).optional(),
  migrationNote: z.string().optional(),
});
export type ScopeFields = z.infer<typeof ScopeFieldsSchema>;

/** Required (strict) scope stamp for NEW scoped collections. */
export const RequiredScopeSchema = z.object({
  scope: Scope,
  tenantId: z.string().nullable().default(null),
  userId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  caseId: z.string().nullable().default(null),
  visibility: Visibility.default('private'),
  createdBy: z.string(),
  updatedBy: z.string().nullable().default(null),
});
export type RequiredScope = z.infer<typeof RequiredScopeSchema>;

/* ------------------------------ actors --------------------------------- */

export const ActorType = z.enum(['human_user', 'service_agent', 'system', 'external_connector']);
export type ActorType = z.infer<typeof ActorType>;

export const GLOBAL_ROLES = ['owner', 'platform_admin', 'platform_operator', 'platform_viewer', 'agent'] as const;
export const TENANT_ROLES = ['tenant_admin', 'tenant_operator', 'reviewer', 'viewer', 'auditor'] as const;
export const PUBLIC_SERVICE_ROLES = ['government_official', 'department_operator', 'case_worker', 'public_service_auditor', 'citizen'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];
export type PublicServiceRole = (typeof PUBLIC_SERVICE_ROLES)[number];

/** Gateway-standard authenticated context resolved for EVERY request. */
export interface AuthContext {
  actorId: string;
  actorType: z.infer<typeof ActorType>;
  primaryUserId?: string;
  activeTenantId?: string;
  activeProjectId?: string;
  activeCaseId?: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  isOwner: boolean;
  sessionId?: string;
}
