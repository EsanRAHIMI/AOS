import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

/** Static manifest served at GET /.factory/manifest and stored by the registry. */
export const manifest: ServiceManifest = {
  serviceId: 'devops-agent',
  serviceName: 'DevOps Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['devops-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'generate_dokploy_instructions',
    'generate_container_spec',
    'generate_env_list',
    'generate_domain_requirements',
    'validate_deployment_readiness',  ],
  dependencies: [
    'gateway-api',
    'architect-agent',
    'service-registry',
    'documentation-service',
    'event-bus-service',  ],
  requiredEnv: [
    'MONGODB_URI',
    'MONGODB_DB_NAME',
    'FACTORY_INTERNAL_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ],
};
