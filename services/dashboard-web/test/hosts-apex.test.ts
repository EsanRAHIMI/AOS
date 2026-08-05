import { describe, it, expect } from 'vitest';
import { isJarvisApexHost, jarvisApexHosts, dashboardCookieDomain, normalizeHost } from '../src/lib/hosts';

describe('hosts — Jarvis apex vs factory control room', () => {
  it('treats simorx.com and www as Jarvis apex by default', () => {
    expect(isJarvisApexHost('simorx.com')).toBe(true);
    expect(isJarvisApexHost('www.simorx.com')).toBe(true);
    expect(isJarvisApexHost('factory.simorx.com')).toBe(false);
    expect(isJarvisApexHost('api.simorx.com')).toBe(false);
  });

  it('strips port from Host header', () => {
    expect(normalizeHost('simorx.com:443')).toBe('simorx.com');
  });

  it('honours JARVIS_PUBLIC_HOSTS override', () => {
    const env = { JARVIS_PUBLIC_HOSTS: 'assistant.example.com' } as NodeJS.ProcessEnv;
    expect(jarvisApexHosts(env)).toEqual(['assistant.example.com']);
    expect(isJarvisApexHost('assistant.example.com', env)).toBe(true);
    expect(isJarvisApexHost('simorx.com', env)).toBe(false);
  });

  it('uses .simorx.com cookie domain in production', () => {
    expect(dashboardCookieDomain({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('.simorx.com');
    expect(dashboardCookieDomain({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(dashboardCookieDomain({ DASHBOARD_COOKIE_DOMAIN: '.example.com' } as NodeJS.ProcessEnv)).toBe('.example.com');
  });
});
