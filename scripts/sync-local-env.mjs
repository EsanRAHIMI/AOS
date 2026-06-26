#!/usr/bin/env node
/**
 * Copy root .env into every service folder and set local SERVICE_* identity.
 * Re-run after changing the root .env shared values.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnvPath = join(root, '.env');

if (!existsSync(rootEnvPath)) {
  console.error('Missing root .env');
  process.exit(1);
}

const rootLines = readFileSync(rootEnvPath, 'utf8').split('\n');
const sharedLines = rootLines.filter(
  (line) =>
    !/^SERVICE_ID=/.test(line) &&
    !/^SERVICE_NAME=/.test(line) &&
    !/^SERVICE_DOMAIN=/.test(line) &&
    !/^SERVICE_PORT=/.test(line),
);

const PEER_BLOCK = `
# --- Local peer URLs (orchestrator) ---
ARCHITECT_AGENT_URL=http://localhost:4103
BUILDER_AGENT_URL=http://localhost:4104
DEVOPS_AGENT_URL=http://localhost:4105
MEMORY_AGENT_URL=http://localhost:4109
DOCUMENTATION_SERVICE_URL=http://localhost:4110
MONITOR_AGENT_URL=http://localhost:4113
BROWSER_TESTING_AGENT_URL=http://localhost:4116
FILE_ASSET_SERVICE_URL=http://localhost:4112
`;

const services = [
  { dir: 'dashboard-web', id: 'dashboard-web', name: 'Dashboard Web', port: 4100, extra: '' },
  { dir: 'gateway-api', id: 'gateway-api', name: 'Gateway API', port: 4101, extra: 'ORCHESTRATOR_AGENT_URL=http://localhost:4102\n' },
  { dir: 'orchestrator-agent', id: 'orchestrator-agent', name: 'Orchestrator Agent', port: 4102, extra: PEER_BLOCK },
  { dir: 'architect-agent', id: 'architect-agent', name: 'Architect Agent', port: 4103, extra: '' },
  { dir: 'builder-agent', id: 'builder-agent', name: 'Builder Agent', port: 4104, extra: '' },
  { dir: 'devops-agent', id: 'devops-agent', name: 'DevOps Agent', port: 4105, extra: '' },
  { dir: 'service-registry', id: 'service-registry', name: 'Service Registry', port: 4108, extra: '' },
  { dir: 'memory-agent', id: 'memory-agent', name: 'Memory Agent', port: 4109, extra: '' },
  { dir: 'documentation-service', id: 'documentation-service', name: 'Documentation Service', port: 4110, extra: '' },
  { dir: 'event-bus-service', id: 'event-bus-service', name: 'Event Bus Service', port: 4111, extra: '' },
  { dir: 'file-asset-service', id: 'file-asset-service', name: 'File Asset Service', port: 4112, extra: '' },
  { dir: 'monitor-agent', id: 'monitor-agent', name: 'Monitor Agent', port: 4113, extra: 'MONITOR_INTERVAL_MS=60000\n' },
  { dir: 'browser-testing-agent', id: 'browser-testing-agent', name: 'Browser Testing Agent', port: 4116, extra: '' },
];

for (const s of services) {
  const identity = [
    '',
    '# --- Per-service identity (local) ---',
    `SERVICE_ID=${s.id}`,
    `SERVICE_NAME=${s.name}`,
    `SERVICE_DOMAIN=http://localhost:${s.port}`,
    `SERVICE_PORT=${s.port}`,
    s.extra ? s.extra.trimEnd() : '',
    '',
  ]
    .filter((l, i, arr) => !(l === '' && arr[i + 1] === ''))
    .join('\n');

  const body = [...sharedLines.filter((l) => l.trim() !== ''), identity].join('\n').trimEnd() + '\n';
  const out = join(root, 'services', s.dir, '.env');
  writeFileSync(out, body);
  console.log(`wrote ${out}`);
}
