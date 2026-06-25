import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

/** Static manifest served at GET /.factory/manifest and stored by the registry. */
export const manifest: ServiceManifest = {
  serviceId: 'builder-agent',
  serviceName: 'Builder Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['builder-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'generate_code',
    'modify_code',
    'create_service_scaffold',
    'create_api_endpoints',
    'create_frontend_components',
    'create_workers',
    'create_tests',  ],
  dependencies: [
    'gateway-api',
    'architect-agent',
    'memory-agent',
    'documentation-service',
    'event-bus-service',
    'service-registry',  ],
  requiredEnv: [
    'MONGODB_URI',
    'MONGODB_DB_NAME',
    'FACTORY_INTERNAL_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ],
};
