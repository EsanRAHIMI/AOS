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
