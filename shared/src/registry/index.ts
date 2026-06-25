import { INTERNAL_TOKEN_HEADER } from '../constants/index.js';
import type { ServiceManifest } from '../schemas/service-manifest.js';

/**
 * Client used by every service to register itself with the service-registry on
 * startup and to look up peer services by id at runtime. Registration is
 * best-effort and retried; a service that cannot reach the registry still runs.
 */
export interface RegistryClientConfig {
  registryUrl: string;
  internalToken: string;
}

export class RegistryClient {
  constructor(private readonly config: RegistryClientConfig) {}

  async register(manifest: ServiceManifest): Promise<boolean> {
    if (!this.config.registryUrl) return false;
    try {
      const res = await fetch(`${this.config.registryUrl}/services`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: this.config.internalToken,
        },
        body: JSON.stringify(manifest),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async resolve(serviceId: string): Promise<ServiceManifest | null> {
    if (!this.config.registryUrl) return null;
    try {
      const res = await fetch(`${this.config.registryUrl}/services/${serviceId}`, {
        headers: { [INTERNAL_TOKEN_HEADER]: this.config.internalToken },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: ServiceManifest };
      return body.data ?? null;
    } catch {
      return null;
    }
  }
}
