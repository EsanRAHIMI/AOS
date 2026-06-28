import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'report-agent',
  serviceName: 'Report Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['report-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['generate_intelligence_report', 'summarize_system_health', 'summarize_learning', 'summarize_security', 'summarize_costs'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry', 'documentation-service', 'memory-agent'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};
