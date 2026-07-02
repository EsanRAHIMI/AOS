import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'voice-operator-agent',
  serviceName: 'Voice Operator Agent',
  serviceType: 'agent',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['voice-operator-agent']}`,
  healthEndpoint: '/health',
  capabilities: ['voice_session_orchestration', 'realtime_token_issuance', 'realtime_webrtc_session', 'context_grounded_explanation', 'tool_mediation', 'voice_memory', 'voice_learning'],
  dependencies: ['gateway-api', 'event-bus-service', 'service-registry', 'memory-agent'],
  requiredEnv: ['MONGODB_URI', 'MONGODB_DB_NAME', 'FACTORY_INTERNAL_TOKEN'],
};
