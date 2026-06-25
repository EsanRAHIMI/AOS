import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'documentation-service',
  serviceName: 'Documentation Service',
  serviceType: 'infra',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['documentation-service']}`,
  healthEndpoint: '/health',
  capabilities: ['store_document', 'list_documents', 'get_document', 'version_document'],
  dependencies: ['event-bus-service'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
