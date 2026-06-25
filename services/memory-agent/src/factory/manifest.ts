import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

/** Static manifest served at GET /.factory/manifest and stored by the registry. */
export const manifest: ServiceManifest = {
  serviceId: 'memory-agent',
  serviceName: 'Memory Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['memory-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'store_task_history',
    'store_decisions',
    'store_patterns',
    'extract_skills',
    'generate_compact_summaries',
    'reduce_token_usage',  ],
  dependencies: [
    'gateway-api',
    'documentation-service',
    'file-asset-service',
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
