import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

/** Static manifest served at GET /.factory/manifest and stored by the registry. */
export const manifest: ServiceManifest = {
  serviceId: 'orchestrator-agent',
  serviceName: 'Orchestrator Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['orchestrator-agent']}`,
  healthEndpoint: '/health',
  capabilities: [
    'receive_goal',
    'decompose_goal',
    'assign_work',
    'track_progress',
    'coordinate_services',
    'request_approval',
    'generate_reports',
    'propose_evolution',  ],
  dependencies: [
    'gateway-api',
    'architect-agent',
    'builder-agent',
    'devops-agent',
    'memory-agent',
    'documentation-service',
    'service-registry',
    'event-bus-service',  ],
  requiredEnv: [
    'MONGODB_URI',
    'MONGODB_DB_NAME',
    'FACTORY_INTERNAL_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ],
};
