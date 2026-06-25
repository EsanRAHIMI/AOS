import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'service-registry',
  serviceName: 'Service Registry',
  serviceType: 'infra',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['service-registry']}`,
  healthEndpoint: '/health',
  capabilities: [
    'register_service',
    'resolve_service',
    'list_services',
    'store_manifest',
    'track_health',
  ],
  dependencies: ['event-bus-service'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
