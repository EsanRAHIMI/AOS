import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'internet-research-service',
  serviceName: 'Internet Research Service',
  serviceType: 'integration',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['internet-research-service']}`,
  healthEndpoint: '/health',
  capabilities: [
    'web_research',
    'source_extraction',
    'citation_capture',
    'freshness_check',
    'reliability_scoring',
    'summary_generation',
  ],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};
