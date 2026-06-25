/**
 * Convenience re-exports of inferred domain types so services can import
 * everything from '@factory/shared' without reaching into subpaths.
 */
export type {
  ServiceManifest,
  ServiceStatus,
} from '../schemas/service-manifest.js';
export type { Task, TaskStatus, TaskRequest, TaskTimelineEntry } from '../schemas/task.js';
export type { AgentRun, AgentMessage, AgentRunStatus } from '../schemas/agent-run.js';
export type {
  InfrastructureRequest,
  InfraRequestStatus,
  DokploySpec,
} from '../schemas/infrastructure-request.js';
export type { SystemEvent, PublishEvent } from '../schemas/event.js';
export type { Approval, ApprovalAction, ApprovalStatus } from '../schemas/approval.js';
export type { Memory, MemoryType, Skill } from '../schemas/memory.js';
export type { S3Object } from '../schemas/s3-object.js';
