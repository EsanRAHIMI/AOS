/**
 * @factory/shared — single import surface for all kernel services.
 *
 * Build-time only: services import contracts, schemas, constants and helpers
 * from here. At runtime, deployed containers communicate over HTTP using these
 * contracts, never by importing each other's code.
 */
export * from './constants/index.js';
export * from './schemas/index.js';
export * as contracts from './contracts/index.js';
export * from './env/index.js';
export * from './logging/index.js';
export * from './utils/index.js';
export * from './http/index.js';
export * from './auth/index.js';
export * from './manifest/index.js';
export * from './db/index.js';
export * from './storage/index.js';
export * from './events/index.js';
export * from './registry/index.js';
export * from './discovery/index.js';
export * from './agentrun/index.js';
export { setTestDb } from './db/index.js';
// Phase 3 — Self-Expanding Capability Engine
export * from './capability/index.js';
export * from './llm/index.js';
export * from './evaluation/index.js';
export * from './generator/index.js';
// Phase 4 — Reality Execution Layer
export * from './validation/index.js';
export * from './github/index.js';
export * from './evidence/index.js';
// Phase 5 — Live Activation & Runtime Autonomy
export * from './activation/index.js';
export * from './deployment/index.js';
// Phase 6 — Autonomous Repair & Execution
export * from './repair/index.js';
// Phase 7 — Strategic Reasoning & Policy-Governed Execution
export * from './planner/index.js';
export * from './scoring/index.js';
export * from './policy/index.js';
// Phase 8 — Learning Governance & Adaptive Intelligence
export * from './governance/index.js';
// Phase 9 — Operational Learning & Memory Intelligence
export * from './learning/index.js';
// Phase 10 — Continuous Learning & Autonomous Improvement
export * from './workflows/index.js';
// Phase 12 — Security, Auth & Production Hardening
export * from './security/index.js';
// Phase 13 — Real Intelligence Integration
export * from './intelligence/index.js';
// Phase 15 — Safe Real Operations
export * from './operations/index.js';
// Phase 16 — Real Dokploy API Execution
export * from './dokploy/index.js';
// Phase 18 — Realtime Voice Operator
export * from './voice/index.js';
