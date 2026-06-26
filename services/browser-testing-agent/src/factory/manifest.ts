import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'browser-testing-agent',
  serviceName: 'Browser Testing Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['browser-testing-agent']}`,
  healthEndpoint: '/health',
  // First entry is the capability id this service provides (validation linkage).
  capabilities: ['browser_testing', 'run_browser_test', 'check_title', 'check_status', 'check_text', 'check_selector', 'capture_screenshot'],
  dependencies: ['event-bus-service', 'service-registry', 'file-asset-service'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
