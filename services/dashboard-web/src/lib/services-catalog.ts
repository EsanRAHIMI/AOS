/**
 * Canonical service catalog — real configuration facts (id, role, subdomain,
 * port, boundary) for the 14 production services. This is documented configuration,
 * not fabricated runtime data; live status (registered? last seen? version?
 * capabilities?) is merged in from the real service registry at render time.
 */
export interface CatalogEntry {
  id: string;
  role: string;
  subdomain: string;
  port: number;
  boundary: 'public-ui' | 'public-api' | 'internal';
}

export const SERVICE_CATALOG: CatalogEntry[] = [
  { id: 'dashboard-web', role: 'Operator control room (this app)', subdomain: 'factory.simorx.com', port: 4100, boundary: 'public-ui' },
  { id: 'gateway-api', role: 'Front door: auth, routing, RBAC, security', subdomain: 'api.simorx.com', port: 4101, boundary: 'public-api' },
  { id: 'orchestrator-agent', role: 'Central planner & coordinator', subdomain: 'orchestrator.simorx.com', port: 4102, boundary: 'internal' },
  { id: 'architect-agent', role: 'Service design & improvement plans', subdomain: 'architect.simorx.com', port: 4103, boundary: 'internal' },
  { id: 'builder-agent', role: 'Implementation & validation', subdomain: 'builder.simorx.com', port: 4104, boundary: 'internal' },
  { id: 'devops-agent', role: 'Deployment plans & GitHub delivery', subdomain: 'devops.simorx.com', port: 4105, boundary: 'internal' },
  { id: 'service-registry', role: 'Knows all live services', subdomain: 'registry.simorx.com', port: 4108, boundary: 'internal' },
  { id: 'memory-agent', role: 'Memory & skill extraction', subdomain: 'memory.simorx.com', port: 4109, boundary: 'internal' },
  { id: 'event-bus-service', role: 'Real-time event stream (SSE)', subdomain: 'events.simorx.com', port: 4111, boundary: 'internal' },
  { id: 'file-asset-service', role: 'File/object storage (S3)', subdomain: 'assets.simorx.com', port: 4112, boundary: 'internal' },
  { id: 'monitor-agent', role: 'Health monitoring & repair loop', subdomain: 'monitor.simorx.com', port: 4113, boundary: 'internal' },
  { id: 'browser-testing-agent', role: 'Governed browser/HTTP testing', subdomain: 'browser-testing.simorx.com', port: 4116, boundary: 'internal' },
  { id: 'voice-operator-agent', role: 'Realtime voice session tokens', subdomain: 'voice.simorx.com', port: 4121, boundary: 'internal' },
  { id: 'code-operator-agent', role: 'Governed code workspace actions', subdomain: 'code.simorx.com', port: 4122, boundary: 'internal' },
];
