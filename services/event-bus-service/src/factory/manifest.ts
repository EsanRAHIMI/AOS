import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'event-bus-service',
  serviceName: 'Event Bus Service',
  serviceType: 'infra',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['event-bus-service']}`,
  healthEndpoint: '/health',
  capabilities: ['publish_event', 'stream_events', 'event_history', 'fanout_sse'],
  dependencies: [],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
