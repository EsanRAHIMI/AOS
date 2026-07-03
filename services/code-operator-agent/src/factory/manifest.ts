import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'code-operator-agent',
  serviceName: 'Code Operator Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['code-operator-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['inspect_repo', 'search_code', 'propose_code_change', 'edit_code', 'run_typecheck', 'build_package', 'run_smoke_tests', 'create_git_branch', 'commit_changes', 'create_pr', 'protected_core_detection', 'workspace_isolation'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
