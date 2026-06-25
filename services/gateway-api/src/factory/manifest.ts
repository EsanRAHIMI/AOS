import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'gateway-api',
  serviceName: 'Gateway API',
  serviceType: 'gateway',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['gateway-api']}`,
  healthEndpoint: '/health',
  capabilities: [
    'create_task',
    'task_status',
    'list_services',
    'approval_workflow',
    'infrastructure_requests',
    'event_access',
    'system_status',
  ],
  dependencies: ['service-registry', 'event-bus-service', 'orchestrator-agent'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'FACTORY_ADMIN_TOKEN'],
};
