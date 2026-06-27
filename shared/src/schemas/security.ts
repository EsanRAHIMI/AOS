import { z } from 'zod';
import { IsoDate } from './common.js';

/* ===========================================================================
 * Phase 12 — Security, Auth & Production Hardening schemas.
 * Records the outcome of production security checks and a trail of
 * security-relevant events (logins, denials, auth failures, abuse).
 * ======================================================================== */

export const SecurityRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type SecurityRiskLevel = z.infer<typeof SecurityRiskLevelSchema>;

/** One line item inside a security check. */
export const SecurityCheckItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  severity: SecurityRiskLevelSchema,
  detail: z.string().default(''),
});
export type SecurityCheckItem = z.infer<typeof SecurityCheckItemSchema>;

/** A stored production-security assessment. */
export const SecurityCheckSchema = z.object({
  checkId: z.string(),
  target: z.string(), // e.g. 'gateway-api', 'system'
  checks: z.array(SecurityCheckItemSchema),
  passed: z.boolean(),
  riskLevel: SecurityRiskLevelSchema,
  recommendations: z.array(z.string()).default([]),
  safeMode: z.boolean().default(false),
  createdAt: IsoDate,
});
export type SecurityCheck = z.infer<typeof SecurityCheckSchema>;

/** A single security-relevant event. */
export const SecurityEventSchema = z.object({
  securityEventId: z.string(),
  eventType: z.string(), // login.succeeded | login.failed | rbac.denied | auth.failed | rate.limited | logout | safe_mode.changed | security.check
  actorId: z.string().default('anonymous'),
  role: z.string().nullable().default(null),
  ip: z.string().default(''),
  userAgent: z.string().default(''),
  target: z.string().default(''),
  result: z.enum(['allowed', 'denied', 'success', 'failure', 'info']),
  riskLevel: SecurityRiskLevelSchema.default('low'),
  detail: z.string().default(''),
  createdAt: IsoDate,
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;
