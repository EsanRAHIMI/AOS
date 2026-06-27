/**
 * Phase 12 — Security engine (pure + testable).
 *
 * Production-readiness checks (env/secrets/tokens/session/safe-mode), an
 * in-memory rate limiter built to be swapped for Redis later, and builders for
 * security checks and security events. No I/O here — callers persist results.
 */
import { genId, nowIso } from '../utils/index.js';
import type { SecurityCheck, SecurityCheckItem, SecurityEvent, SecurityRiskLevel as RiskLevel } from '../schemas/security.js';

/* -------------------- env / secret audit -------------------- */

export interface EnvAuditInput {
  nodeEnv?: string;
  factoryEnv?: string;
  internalToken?: string;
  adminToken?: string;
  sessionSecret?: string;
  mongoUri?: string;
  s3?: { accessKeyId?: string; secretAccessKey?: string; bucket?: string; region?: string };
  llm?: { openai?: string; anthropic?: string };
  githubToken?: string;
  safeMode?: boolean;
}

const PLACEHOLDER = /^(|change.?me|changeme|placeholder|example|your[-_].*|x{4,}|secret|token|admin|password|test|test123|dev|default|none|null|undefined)$/i;

function present(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
function isPlaceholder(v: string | undefined): boolean {
  return !present(v) || PLACEHOLDER.test((v ?? '').trim());
}

const SEVERITY_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function item(id: string, label: string, passed: boolean, severity: RiskLevel, detail = ''): SecurityCheckItem {
  return { id, label, passed, severity, detail };
}

/**
 * Audit environment/secret configuration. Returns the individual checks plus an
 * aggregate pass/risk and concrete recommendations. Pure — no process.env read.
 */
export function auditEnvironment(input: EnvAuditInput): {
  checks: SecurityCheckItem[];
  passed: boolean;
  riskLevel: RiskLevel;
  recommendations: string[];
} {
  const isProd = input.nodeEnv === 'production' || input.factoryEnv === 'production';
  const checks: SecurityCheckItem[] = [];
  const recs: string[] = [];

  // Internal service token
  const internalOk = present(input.internalToken) && !isPlaceholder(input.internalToken) && (input.internalToken ?? '').length >= 16;
  checks.push(item('internal_token', 'Internal service token set and strong', internalOk, 'critical', internalOk ? 'present, ≥16 chars, non-placeholder' : 'missing, weak, or placeholder'));
  if (!internalOk) recs.push('Set FACTORY_INTERNAL_TOKEN to a strong random value (≥32 chars) shared by all services.');

  // Admin token
  const adminOk = present(input.adminToken) && !isPlaceholder(input.adminToken) && (input.adminToken ?? '').length >= 16 && input.adminToken !== input.internalToken;
  checks.push(item('admin_token', 'Admin token set, strong, and distinct from internal token', adminOk, 'high', adminOk ? 'present and distinct' : 'missing, weak, placeholder, or equal to internal token'));
  if (!adminOk) recs.push('Set FACTORY_ADMIN_TOKEN to a strong random value distinct from FACTORY_INTERNAL_TOKEN.');

  // Dashboard session secret
  const sessionMin = isProd ? 32 : 16;
  const sessionOk = present(input.sessionSecret) && !isPlaceholder(input.sessionSecret) && (input.sessionSecret ?? '').length >= sessionMin;
  checks.push(item('session_secret', 'Dashboard session secret set and strong', sessionOk, isProd ? 'critical' : 'high', sessionOk ? `present, ≥${sessionMin} chars` : 'missing, weak, or placeholder'));
  if (!sessionOk) recs.push(`Set DASHBOARD_SESSION_SECRET to a random value (≥${sessionMin} chars) so session cookies cannot be forged.`);

  // Mongo
  const mongoOk = present(input.mongoUri);
  checks.push(item('mongodb_uri', 'MongoDB connection string present', mongoOk, 'critical', mongoOk ? 'present' : 'missing'));
  if (!mongoOk) recs.push('Set MONGODB_URI to your MongoDB Atlas connection string.');

  // S3 (only graded if any value provided; otherwise informational)
  const s3Any = input.s3 && (present(input.s3.accessKeyId) || present(input.s3.secretAccessKey) || present(input.s3.bucket));
  if (s3Any) {
    const s3Ok = present(input.s3?.accessKeyId) && present(input.s3?.secretAccessKey) && present(input.s3?.bucket) && present(input.s3?.region);
    checks.push(item('s3_credentials', 'S3 credentials complete', s3Ok, 'medium', s3Ok ? 'all keys present' : 'partial S3 config'));
    if (!s3Ok) recs.push('Complete AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET or remove them to disable file storage.');
  } else {
    checks.push(item('s3_credentials', 'S3 file storage', true, 'low', 'not configured (optional)'));
  }

  // LLM keys (optional → informational)
  const llmConfigured = present(input.llm?.openai) || present(input.llm?.anthropic);
  checks.push(item('llm_keys', 'LLM provider keys', true, 'low', llmConfigured ? 'configured (real LLM)' : 'not configured (deterministic fallback)'));
  if (!llmConfigured) recs.push('Optional: set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable real LLM reasoning (system runs on deterministic fallback otherwise).');

  // GitHub (optional → informational)
  checks.push(item('github_token', 'GitHub delivery token', true, 'low', present(input.githubToken) ? 'configured' : 'not configured (prepared-only delivery)'));

  // Production posture
  if (isProd) {
    checks.push(item('production_env', 'Running in production posture', true, 'low', 'NODE_ENV/FACTORY_ENV = production'));
  }

  // Aggregate: only non-informational failures count toward pass/risk.
  const required = checks.filter((c) => c.severity !== 'low');
  const passed = required.every((c) => c.passed);
  const worstFailed = required.filter((c) => !c.passed).reduce<RiskLevel>((worst, c) => (SEVERITY_RANK[c.severity] > SEVERITY_RANK[worst] ? c.severity : worst), 'low');
  const riskLevel: RiskLevel = passed ? 'low' : worstFailed;

  return { checks, passed, riskLevel, recommendations: recs };
}

/** Build a stored SecurityCheck from audited items. */
export function buildSecurityCheck(target: string, audit: { checks: SecurityCheckItem[]; passed: boolean; riskLevel: RiskLevel; recommendations: string[] }, safeMode = false): SecurityCheck {
  return {
    checkId: genId('seccheck'),
    target,
    checks: audit.checks,
    passed: audit.passed,
    riskLevel: audit.riskLevel,
    recommendations: audit.recommendations,
    safeMode,
    createdAt: nowIso(),
  };
}

/* -------------------- security events -------------------- */

export interface SecurityEventArgs {
  eventType: string;
  actorId?: string;
  role?: string | null;
  ip?: string;
  userAgent?: string;
  target?: string;
  result: SecurityEvent['result'];
  riskLevel?: RiskLevel;
  detail?: string;
}

export function buildSecurityEvent(args: SecurityEventArgs): SecurityEvent {
  return {
    securityEventId: genId('secevt'),
    eventType: args.eventType,
    actorId: args.actorId ?? 'anonymous',
    role: args.role ?? null,
    ip: args.ip ?? '',
    userAgent: args.userAgent ?? '',
    target: args.target ?? '',
    result: args.result,
    riskLevel: args.riskLevel ?? 'low',
    detail: args.detail ?? '',
    createdAt: nowIso(),
  };
}

/* -------------------- rate limiting -------------------- */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

/**
 * Fixed-window in-memory rate limiter. Keyed by an arbitrary string (e.g.
 * `login:<ip>` or `task:<token>`). Single-process only; the interface is kept
 * deliberately small so a Redis-backed implementation can replace it later.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly defaultLimit = 30, private readonly windowMs = 60_000) {}

  check(key: string, limit = this.defaultLimit, windowMs = this.windowMs): RateLimitResult {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, limit, retryAfterMs: 0 };
    }
    cur.count += 1;
    if (cur.count > limit) {
      return { allowed: false, remaining: 0, limit, retryAfterMs: cur.resetAt - now };
    }
    return { allowed: true, remaining: limit - cur.count, limit, retryAfterMs: 0 };
  }

  /** Periodically drop expired windows to bound memory. */
  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  snapshot(): Array<{ key: string; count: number; resetAt: string }> {
    return [...this.hits.entries()].map(([key, v]) => ({ key, count: v.count, resetAt: new Date(v.resetAt).toISOString() }));
  }
}
