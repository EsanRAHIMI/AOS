import { SERVICE_SUBDOMAINS, SERVICE_VERSION, type ServiceManifest } from '@factory/shared';

export const manifest: ServiceManifest = {
  serviceId: 'file-asset-service',
  serviceName: 'File Asset Service',
  serviceType: 'infra',
  version: SERVICE_VERSION,
  domain: `https://${SERVICE_SUBDOMAINS['file-asset-service']}`,
  healthEndpoint: '/health',
  capabilities: ['presign_upload', 'record_metadata', 'signed_download', 'delete_object'],
  dependencies: ['event-bus-service'],
  requiredEnv: [
    'MONGODB_URI',
    'MONGODB_DB_NAME',
    'FACTORY_INTERNAL_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_S3_BUCKET',
  ],
};
