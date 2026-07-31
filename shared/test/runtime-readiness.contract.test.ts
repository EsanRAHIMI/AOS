import { describe, expect, it } from 'vitest';
import { assessRuntimeConfiguration, runtimeConfigurationExitCode } from '../src/readiness/runtime.js';

const validEnv = (): NodeJS.ProcessEnv => ({
  FACTORY_ENV: 'local',
  MONGODB_URI: 'mongodb+srv://user:password@example.invalid/aos',
  REDIS_URL: 'rediss://user:password@example.invalid:6379',
  AGENT_DISPATCH_MODE: 'queue_with_http_fallback',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4100/api/calendar/callback',
  GOOGLE_TOKEN_ENC_KEY: 'a'.repeat(64),
  OPENAI_API_KEY: 'sk-fixture-value-that-must-never-appear',
  FACTORY_INTERNAL_TOKEN: 'internal-token-with-enough-entropy',
  FACTORY_ADMIN_TOKEN: 'admin-token-with-different-entropy',
  DASHBOARD_SESSION_SECRET: 'session-secret-with-at-least-thirty-two-characters',
});

describe('runtime readiness contract', () => {
  it('accepts a complete local configuration without exposing values', () => {
    const env = validEnv();
    const checks = assessRuntimeConfiguration(env);
    expect(checks.every((check) => check.status === 'ready')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(env.MONGODB_URI);
    expect(JSON.stringify(checks)).not.toContain(env.OPENAI_API_KEY);
    expect(runtimeConfigurationExitCode(checks)).toBe(0);
  });

  it('warns when Redis exists but dispatch still bypasses it', () => {
    const env = validEnv();
    env.AGENT_DISPATCH_MODE = 'http';
    const checks = assessRuntimeConfiguration(env);
    expect(checks.find((check) => check.id === 'dispatch_config')?.status).toBe('warning');
    expect(runtimeConfigurationExitCode(checks)).toBe(0);
    expect(runtimeConfigurationExitCode(checks, true)).toBe(2);
  });

  it('always gives a blocked check precedence over strict warnings', () => {
    expect(runtimeConfigurationExitCode([
      { id: 'dispatch_config', status: 'warning', summary: 'warning', action: '' },
      { id: 'mongo_config', status: 'blocked', summary: 'blocked', action: '' },
    ], true)).toBe(1);
  });

  it('blocks queue dispatch when Redis is unavailable', () => {
    const env = validEnv();
    delete env.REDIS_URL;
    const checks = assessRuntimeConfiguration(env);
    expect(checks.find((check) => check.id === 'redis_config')?.status).toBe('blocked');
    expect(checks.find((check) => check.id === 'dispatch_config')?.status).toBe('blocked');
    expect(runtimeConfigurationExitCode(checks)).toBe(1);
  });

  it('rejects weak or reused runtime secrets', () => {
    const env = validEnv();
    env.FACTORY_ADMIN_TOKEN = env.FACTORY_INTERNAL_TOKEN;
    env.DASHBOARD_SESSION_SECRET = 'too-short';
    const check = assessRuntimeConfiguration(env).find((item) => item.id === 'security_config');
    expect(check?.status).toBe('blocked');
  });

  it('requires a real 32-byte Google vault key and HTTPS in production', () => {
    const invalidKey = validEnv();
    invalidKey.GOOGLE_TOKEN_ENC_KEY = 'present-but-not-a-key';
    expect(assessRuntimeConfiguration(invalidKey).find((item) => item.id === 'google_oauth_config')?.status).toBe('blocked');

    const production = validEnv();
    production.FACTORY_ENV = 'production';
    expect(assessRuntimeConfiguration(production).find((item) => item.id === 'google_oauth_config')?.status).toBe('blocked');
    production.GOOGLE_REDIRECT_URI = 'https://app.example.com/api/calendar/callback';
    expect(assessRuntimeConfiguration(production).find((item) => item.id === 'google_oauth_config')?.status).toBe('ready');
  });
});
