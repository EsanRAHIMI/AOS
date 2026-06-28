import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'qa-agent',
  serviceName: 'QA Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['qa-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['verify_acceptance_criteria', 'check_evidence', 'compare_to_goal', 'qa_pass_fail'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
};
