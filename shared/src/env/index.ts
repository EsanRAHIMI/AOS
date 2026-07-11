import { z } from 'zod';

/**
 * Validated environment loader. Each service composes the shared base schema
 * with its own required keys and calls loadEnv() once at boot. Fail fast on
 * misconfiguration rather than crashing deep inside a request.
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  FACTORY_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  FACTORY_PUBLIC_URL: z.string().default(''),
  FACTORY_API_URL: z.string().default(''),
  FACTORY_INTERNAL_TOKEN: z.string().min(1, 'FACTORY_INTERNAL_TOKEN is required'),
  FACTORY_ADMIN_TOKEN: z.string().optional().default(''),

  /**
   * K1 Real Auth (D-164) kill-switch. When true (the K1 default), the gateway
   * still honors the legacy `x-factory-admin-token` + `x-factory-role`
   * self-declared-role path for human requests that carry no real session
   * token — this is what keeps CI, existing internal tooling, and the
   * dashboard's transition period working. Set to false to require every
   * human request to carry a real, valid session token (x-factory-session-
   * token); admin-token-only human requests then resolve to the
   * least-privileged RoleName ('viewer') instead of the self-declared role.
   * This does not affect FACTORY_INTERNAL_TOKEN service-to-service auth.
   * See docs/security-and-permissions.md and decision-log D-164.
   */
  FACTORY_ALLOW_LEGACY_ROLE_AUTH: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(true)
    .transform((v) => v === true || v === 'true' || v === '1'),

  /**
   * K1 Real Auth (D-164): the platform owner's login credential, in the same
   * `scrypt$<saltHex>$<hashHex>` format `scripts/hash-password.mjs` already
   * produces (reuse the same value dashboard-web's DASHBOARD_ADMIN_PASSWORD_
   * HASH already uses, or generate a fresh one). Deliberately has NO default
   * value and the system NEVER generates or logs a plaintext password: if
   * this is unset, the owner user_account simply is not seeded and
   * POST /v1/auth/login has nothing to authenticate the owner against yet —
   * a clear startup warning explains exactly what to configure.
   */
  FACTORY_OWNER_PASSWORD_HASH: z.string().optional().default(''),
  FACTORY_OWNER_EMAIL: z.string().optional().default('owner@local'),

  /**
   * Emergency kill-switch. When true, services refuse mutation/deploy/repair/
   * governance execution and operate read/monitor/report-only. The live value
   * is mirrored in `system_settings` so the owner can toggle it at runtime;
   * this env provides the initial/default.
   */
  AUTONOMY_SAFE_MODE: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((v) => v === true || v === 'true' || v === '1'),

  SERVICE_ID: z.string().min(1),
  SERVICE_NAME: z.string().min(1),
  SERVICE_DOMAIN: z.string().optional().default(''),
  SERVICE_PORT: z.coerce.number().int().positive(),

  SERVICE_REGISTRY_URL: z.string().optional().default(''),
  EVENT_BUS_URL: z.string().optional().default(''),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});
export type BaseEnv = z.infer<typeof BaseEnvSchema>;

export const MongoEnvSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().default('autonomous_os_kernel'),
});

/**
 * K1 Redis Backbone (D-167). Optional, not required — deliberately NOT part
 * of BaseEnvSchema since only gateway-api and event-bus-service use it.
 * REDIS_URL empty (the default) means Redis is disabled: every consumer
 * (RedisBackbone, EventBroadcaster, the rate limiter's Redis path) falls
 * back to local/in-process behavior, clearly logged as degraded, never
 * throwing. This is the correct default for local/dev/test/single-instance
 * deployments — Redis only matters once a service is horizontally scaled.
 * See docs/service-communication-protocol.md and decision-log D-167.
 */
export const RedisEnvSchema = z.object({
  REDIS_URL: z.string().optional().default(''),
  REDIS_KEY_PREFIX: z.string().optional().default('factory:'),
});

/**
 * K1 BullMQ Task Queue (D-173). Optional, not required — reuses `REDIS_URL`
 * from `RedisEnvSchema` (queue workers only start when it's set; unset means
 * `aos-agent-runtime` runs HTTP-only, identical to before this workstream).
 * These four control retry/backoff/concurrency/timeout for the BullMQ
 * `Worker`s only — they have no effect when `REDIS_URL` is unset.
 */
export const AgentQueueEnvSchema = z.object({
  AGENT_QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().optional().default(3),
  AGENT_QUEUE_BACKOFF_MS: z.coerce.number().int().positive().optional().default(2000),
  AGENT_QUEUE_CONCURRENCY: z.coerce.number().int().positive().optional().default(4),
  AGENT_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30000),
  /**
   * K1 BullMQ Producer Adoption (D-174). Default `http` is BYTE-IDENTICAL to
   * pre-D-174 behavior — the queue producer code path is not even attempted.
   * `queue_with_http_fallback` tries the queue first and falls back to HTTP
   * on any failure, always emitting AGENT_DISPATCH_DEGRADED (never a silent
   * fallback). `queue_only` never falls back — a queue failure is surfaced
   * directly, for environments that have already proven queue reliability.
   * See docs/decision-log.md D-174.
   */
  AGENT_DISPATCH_MODE: z.enum(['http', 'queue_with_http_fallback', 'queue_only']).optional().default('http'),
});

export const S3EnvSchema = z.object({
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET: z.string().min(1),
});

export const LlmEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  LLM_DEFAULT_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  // Phase 13 — provider governance + budget controls.
  LLM_ALLOWED_PROVIDERS: z.string().optional().default('anthropic,openai'),
  LLM_MAX_COST_PER_TASK_USD: z.coerce.number().optional().default(0.5),
  LLM_MAX_TOKENS_PER_TASK: z.coerce.number().optional().default(120000),
  LLM_DAILY_COST_LIMIT_USD: z.coerce.number().optional().default(20),
  // When true, an active safe mode also forces deterministic fallback (no provider calls).
  LLM_SAFE_MODE_FALLBACK: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(true)
    .transform((v) => v === true || v === 'true' || v === '1'),
});

/**
 * Phase AG — real web search grounding for internet-research-service.
 * Optional: `webSearchProviderFromEnv()` (shared/src/research) returns null
 * when unset, and the research engine falls back to its pre-existing
 * LLM-recall/curated behavior, honestly marked as such.
 */
export const ResearchEnvSchema = z.object({
  TAVILY_API_KEY: z.string().optional().default(''),
});

/**
 * Parse process.env against a schema, exiting with a readable error if invalid.
 */
export function loadEnv<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Surface a clear, actionable message at startup.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
