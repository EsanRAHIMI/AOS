import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

/** Static manifest served at GET /.factory/manifest and stored by the registry. */
export const manifest: ServiceManifest = {
  serviceId: 'architect-agent',
  serviceName: 'Architect Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['architect-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'design_service_architecture',
    'define_service_boundaries',
    'generate_api_contracts',
    'define_database_schema',
    'define_event_flows',
    'define_env_vars',
    'create_deployment_requirements',  ],
  dependencies: [
    'gateway-api',
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
