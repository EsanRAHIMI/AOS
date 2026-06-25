/**
 * Cross-service API contracts. These describe the request/response shapes that
 * services rely on to talk to each other over HTTP. Keeping them in shared/
 * guarantees consistency; the wire protocol itself stays HTTP + internal token.
 */
import type { ServiceManifest, ServiceStatus } from '../schemas/service-manifest.js';
import type { Task, TaskRequest, TaskTimelineEntry } from '../schemas/task.js';
import type { InfrastructureRequest } from '../schemas/infrastructure-request.js';
import type { Approval, ApprovalAction } from '../schemas/approval.js';
import type { SystemEvent } from '../schemas/event.js';

/** Standard endpoints every factory service implements (see FACTORY_ENDPOINTS). */
export interface FactoryServiceContract {
  'GET /health': { response: { status: 'ok'; serviceId: string } };
  'GET /.factory/manifest': { response: ServiceManifest };
  'GET /.factory/status': { response: ServiceStatus };
  'GET /.factory/capabilities': { response: { capabilities: string[] } };
  'POST /.factory/task': { body: TaskRequest; response: { taskId: string; accepted: boolean } };
  'GET /.factory/logs': { response: { lines: string[] } };
}

/** gateway-api surface consumed by the dashboard and external callers. */
export interface GatewayContract {
  'POST /v1/tasks': { body: TaskRequest; response: Task };
  'GET /v1/tasks': { response: Task[] };
  'GET /v1/tasks/:id': { response: Task };
  'GET /v1/tasks/:id/timeline': { response: TaskTimelineEntry[] };
  'GET /v1/services': { response: ServiceManifest[] };
  'GET /v1/approvals': { response: Approval[] };
  'POST /v1/approvals/:id/decision': {
    body: { action: ApprovalAction; reason?: string };
    response: Approval;
  };
  'GET /v1/infrastructure': { response: InfrastructureRequest[] };
  'POST /v1/infrastructure/:id/confirm': { response: InfrastructureRequest };
  'GET /v1/events/stream': { response: 'text/event-stream of SystemEvent' };
}

export type { ServiceManifest, ServiceStatus, Task, TaskRequest, InfrastructureRequest, Approval, SystemEvent };
