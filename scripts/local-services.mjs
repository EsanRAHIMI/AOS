/**
 * Single source of truth for local dev: ports, order, and per-service env extras.
 * Used by sync-local-env.mjs and dev-all.mjs — keep in sync with README-SETUP.md.
 *
 * Production truth: 19 independently deployable services (see docs/service-map.md).
 * `LOCAL_SERVICES` below matches those 19.
 *
 * K1 Consolidation Prep (D-168/D-172): services/aos-agent-runtime is a
 * transitional CANDIDATE that can host architect/reviewer/qa/report (and later
 * memory/documentation/research) on the same historical ports. It is
 * deliberately NOT added to LOCAL_SERVICES — doing so would make it start
 * automatically, which would misrepresent cutover as already decided
 * (production still runs the standalone services). It also CANNOT run
 * alongside `architect-agent` (entry #5) in local dev: both bind port 4103,
 * so the second one to start fails with EADDRINUSE.
 *
 * To try aos-agent-runtime locally instead of the standalone agents: stop
 * architect-agent / reviewer-agent / qa-agent / report-agent, then copy
 * `services/aos-agent-runtime/.env.example` → `.env` (it is NOT written by
 * `pnpm sync:env`), then `cd services/aos-agent-runtime && pnpm dev`.
 * Full cutover: deployment/dokploy/aos-agent-runtime.md.
 */

export const PEER_BLOCK = `# --- Local peer URLs (orchestrator) ---
ARCHITECT_AGENT_URL=http://localhost:4103
BUILDER_AGENT_URL=http://localhost:4104
DEVOPS_AGENT_URL=http://localhost:4105
REVIEWER_AGENT_URL=http://localhost:4106
QA_AGENT_URL=http://localhost:4107
MEMORY_AGENT_URL=http://localhost:4109
DOCUMENTATION_SERVICE_URL=http://localhost:4110
INTERNET_RESEARCH_SERVICE_URL=http://localhost:4115
MONITOR_AGENT_URL=http://localhost:4113
REPORT_AGENT_URL=http://localhost:4114
BROWSER_TESTING_AGENT_URL=http://localhost:4116
FILE_ASSET_SERVICE_URL=http://localhost:4112`;

/** Deploy / dev:start order (matches README-SETUP.md sections 1–19). */
export const LOCAL_SERVICES = [
  {
    num: 1,
    dir: 'service-registry',
    id: 'service-registry',
    name: 'Service Registry',
    port: 4108,
    pkg: '@factory/service-registry',
    alias: 'registry',
    color: 'blue',
    extra: '',
  },
  {
    num: 2,
    dir: 'event-bus-service',
    id: 'event-bus-service',
    name: 'Event Bus Service',
    port: 4111,
    pkg: '@factory/event-bus-service',
    alias: 'events',
    color: 'cyan',
    extra: '',
  },
  {
    num: 3,
    dir: 'gateway-api',
    id: 'gateway-api',
    name: 'Gateway API',
    port: 4101,
    pkg: '@factory/gateway-api',
    alias: 'gateway',
    color: 'green',
    // Phase AG.4 — INTERNET_RESEARCH_SERVICE_URL pins gateway-api's research
    // dispatch to localhost even though internet-research-service self-
    // registers with the local service-registry using its hardcoded
    // PRODUCTION manifest domain (research.simorx.com) — without this
    // override, resolvePeerUrl() would use that registry-resolved domain
    // instead of localhost once the service is actually running (see
    // decision-log D-14x). Same override mechanism as ORCHESTRATOR_AGENT_URL.
    extra: 'ORCHESTRATOR_AGENT_URL=http://localhost:4102\nINTERNET_RESEARCH_SERVICE_URL=http://localhost:4115',
  },
  {
    num: 4,
    dir: 'orchestrator-agent',
    id: 'orchestrator-agent',
    name: 'Orchestrator Agent',
    port: 4102,
    pkg: '@factory/orchestrator-agent',
    alias: 'orch',
    color: 'magenta',
    extra: PEER_BLOCK,
  },
  {
    num: 5,
    dir: 'architect-agent',
    id: 'architect-agent',
    name: 'Architect Agent',
    port: 4103,
    pkg: '@factory/architect-agent',
    alias: 'arch',
    color: 'yellow',
    extra: '',
  },
  {
    num: 6,
    dir: 'builder-agent',
    id: 'builder-agent',
    name: 'Builder Agent',
    port: 4104,
    pkg: '@factory/builder-agent',
    alias: 'build',
    color: 'red',
    extra: '',
  },
  {
    num: 7,
    dir: 'devops-agent',
    id: 'devops-agent',
    name: 'DevOps Agent',
    port: 4105,
    pkg: '@factory/devops-agent',
    alias: 'devops',
    color: 'white',
    extra: '',
  },
  {
    num: 8,
    dir: 'reviewer-agent',
    id: 'reviewer-agent',
    name: 'Reviewer Agent',
    port: 4106,
    pkg: '@factory/reviewer-agent',
    alias: 'review',
    color: 'redBright',
    extra: '',
  },
  {
    num: 9,
    dir: 'qa-agent',
    id: 'qa-agent',
    name: 'QA Agent',
    port: 4107,
    pkg: '@factory/qa-agent',
    alias: 'qa',
    color: 'greenBright',
    extra: '',
  },
  {
    num: 10,
    dir: 'memory-agent',
    id: 'memory-agent',
    name: 'Memory Agent',
    port: 4109,
    pkg: '@factory/memory-agent',
    alias: 'memory',
    color: 'gray',
    extra: '',
  },
  {
    num: 11,
    dir: 'documentation-service',
    id: 'documentation-service',
    name: 'Documentation Service',
    port: 4110,
    pkg: '@factory/documentation-service',
    alias: 'docs',
    color: 'blueBright',
    extra: '',
  },
  {
    num: 12,
    dir: 'internet-research-service',
    id: 'internet-research-service',
    name: 'Internet Research Service',
    port: 4115,
    pkg: '@factory/internet-research-service',
    alias: 'research',
    color: 'yellow',
    extra: '',
  },
  {
    num: 13,
    dir: 'file-asset-service',
    id: 'file-asset-service',
    name: 'File Asset Service',
    port: 4112,
    pkg: '@factory/file-asset-service',
    alias: 'assets',
    color: 'greenBright',
    extra: '',
  },
  {
    num: 14,
    dir: 'monitor-agent',
    id: 'monitor-agent',
    name: 'Monitor Agent',
    port: 4113,
    pkg: '@factory/monitor-agent',
    alias: 'monitor',
    color: 'cyanBright',
    extra: 'MONITOR_INTERVAL_MS=60000',
  },
  {
    num: 15,
    dir: 'report-agent',
    id: 'report-agent',
    name: 'Report Agent',
    port: 4114,
    pkg: '@factory/report-agent',
    alias: 'report',
    color: 'blue',
    extra: '',
  },
  {
    num: 16,
    dir: 'browser-testing-agent',
    id: 'browser-testing-agent',
    name: 'Browser Testing Agent',
    port: 4116,
    pkg: '@factory/browser-testing-agent',
    alias: 'browser',
    color: 'magentaBright',
    extra: '',
  },
  {
    num: 17,
    dir: 'voice-operator-agent',
    id: 'voice-operator-agent',
    name: 'Voice Operator Agent',
    port: 4121,
    pkg: '@factory/voice-operator-agent',
    alias: 'voice',
    color: 'cyan',
    extra: '',
  },
  {
    num: 18,
    dir: 'code-operator-agent',
    id: 'code-operator-agent',
    name: 'Code Operator Agent',
    port: 4122,
    pkg: '@factory/code-operator-agent',
    alias: 'code',
    color: 'yellowBright',
    extra: '',
  },
  {
    num: 19,
    dir: 'dashboard-web',
    id: 'dashboard-web',
    name: 'Dashboard Web',
    port: 4100,
    pkg: '@factory/dashboard-web',
    alias: 'dash',
    color: 'whiteBright',
    extra: '',
  },
];
