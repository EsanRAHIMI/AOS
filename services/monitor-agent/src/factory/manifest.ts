import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'monitor-agent',
  serviceName: 'Monitor Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['monitor-agent'] ?? 'monitor.simorx.com'}`,
  healthEndpoint: '/health',
  capabilities: ['health_monitoring', 'service_activation', 'incident_detection', 'repair_proposal'],
  dependencies: ['service-registry', 'event-bus-service'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'SERVICE_REGISTRY_URL'],
};
