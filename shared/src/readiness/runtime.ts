import { vaultAvailability } from '../calendar/tokens.js';

export type RuntimeCheckStatus = 'ready' | 'warning' | 'blocked';

export interface RuntimeConfigCheck {
  id: 'mongo_config' | 'redis_config' | 'dispatch_config' | 'google_oauth_config' | 'model_config' | 'security_config';
  status: RuntimeCheckStatus;
  summary: string;
  action: string;
}

function set(env: NodeJS.ProcessEnv, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function validUrl(value: string | undefined, protocols: string[]): boolean {
  try {
    const url = new URL(value ?? '');
    return protocols.includes(url.protocol);
  } catch {
    return false;
  }
}

function tokenStrong(value: string | undefined, minimumLength = 16): boolean {
  const v = value?.trim() ?? '';
  return v.length >= minimumLength && !/^(change.?me|example|placeholder|test|secret|token|admin)$/i.test(v);
}

/** Pure, secret-free assessment used by both CI tests and the live preflight. */
export function assessRuntimeConfiguration(env: NodeJS.ProcessEnv): RuntimeConfigCheck[] {
  const checks: RuntimeConfigCheck[] = [];
  const mongoReady = validUrl(env.MONGODB_URI, ['mongodb:', 'mongodb+srv:']);
  checks.push({
    id: 'mongo_config', status: mongoReady ? 'ready' : 'blocked',
    summary: mongoReady ? 'MongoDB configuration is present.' : 'MongoDB URI is missing or invalid.',
    action: mongoReady ? '' : 'Set MONGODB_URI to a mongodb:// or mongodb+srv:// URI.',
  });

  const redisReady = validUrl(env.REDIS_URL, ['redis:', 'rediss:']);
  checks.push({
    id: 'redis_config', status: redisReady ? 'ready' : 'blocked',
    summary: redisReady ? 'Redis configuration is present.' : 'Redis URL is missing or invalid.',
    action: redisReady ? '' : 'Set REDIS_URL to a redis:// or rediss:// URI.',
  });

  const mode = env.AGENT_DISPATCH_MODE || 'http';
  const validMode = ['http', 'queue_with_http_fallback', 'queue_only'].includes(mode);
  const dispatchStatus: RuntimeCheckStatus = !validMode || (mode !== 'http' && !redisReady)
    ? 'blocked'
    : mode === 'http' && redisReady ? 'warning' : 'ready';
  checks.push({
    id: 'dispatch_config', status: dispatchStatus,
    summary: !validMode
      ? `Unknown agent dispatch mode: ${mode}.`
      : mode === 'http' && redisReady
        ? 'Redis is configured, but agent dispatch still uses HTTP only.'
        : `Agent dispatch mode is ${mode}.`,
    action: dispatchStatus === 'warning'
      ? 'After queue verification, set AGENT_DISPATCH_MODE=queue_with_http_fallback on gateway and orchestrator.'
      : dispatchStatus === 'blocked' ? 'Use a supported dispatch mode and configure Redis for queue modes.' : '',
  });

  const googleReady = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_TOKEN_ENC_KEY'].every((k) => set(env, k));
  const redirectReady = validUrl(env.GOOGLE_REDIRECT_URI, ['http:', 'https:']);
  const productionRedirectReady = env.FACTORY_ENV !== 'production' || validUrl(env.GOOGLE_REDIRECT_URI, ['https:']);
  const vaultReady = vaultAvailability(env).configured;
  const oauthReady = googleReady && redirectReady && productionRedirectReady && vaultReady;
  checks.push({
    id: 'google_oauth_config', status: oauthReady ? 'ready' : 'blocked',
    summary: oauthReady ? 'Google OAuth configuration is complete.' : 'Google OAuth configuration, redirect URI or token-encryption key is invalid.',
    action: oauthReady ? '' : 'Set all OAuth values, use a 32-byte encryption key, and require HTTPS outside local development.',
  });

  const modelReady = set(env, 'LLM_LOCAL_BASE_URL') || set(env, 'ANTHROPIC_API_KEY') || set(env, 'OPENAI_API_KEY');
  checks.push({
    id: 'model_config', status: modelReady ? 'ready' : 'blocked',
    summary: modelReady ? 'A model provider is configured.' : 'No model provider is configured.',
    action: modelReady ? '' : 'Configure a local OpenAI-compatible model or a cloud provider key.',
  });

  const securityReady = tokenStrong(env.FACTORY_INTERNAL_TOKEN)
    && tokenStrong(env.FACTORY_ADMIN_TOKEN)
    && tokenStrong(env.DASHBOARD_SESSION_SECRET, 32)
    && env.FACTORY_INTERNAL_TOKEN !== env.FACTORY_ADMIN_TOKEN;
  checks.push({
    id: 'security_config', status: securityReady ? 'ready' : 'blocked',
    summary: securityReady ? 'Runtime secrets are present, strong and distinct.' : 'One or more runtime secrets are weak, missing or reused.',
    action: securityReady ? '' : 'Use distinct random internal/admin tokens and a session secret of at least 32 characters.',
  });

  return checks;
}

export function runtimeConfigurationExitCode(checks: RuntimeConfigCheck[], strict = false): 0 | 1 | 2 {
  if (checks.some((c) => c.status === 'blocked')) return 1;
  if (strict && checks.some((c) => c.status === 'warning')) return 2;
  return 0;
}
