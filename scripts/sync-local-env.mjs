#!/usr/bin/env node
/**
 * Copy root .env into every service folder and set local SERVICE_* identity.
 * Re-run after changing the root .env shared values.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_SERVICES } from './local-services.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnvPath = join(root, '.env');

if (!existsSync(rootEnvPath)) {
  console.error('Missing root .env — run: cp .env.example .env');
  process.exit(1);
}

const rootLines = readFileSync(rootEnvPath, 'utf8').split('\n');
const sharedLines = rootLines.filter(
  (line) =>
    !/^SERVICE_ID=/.test(line) &&
    !/^SERVICE_NAME=/.test(line) &&
    !/^SERVICE_DOMAIN=/.test(line) &&
    !/^SERVICE_PORT=/.test(line) &&
    !/^ORCHESTRATOR_AGENT_URL=/.test(line) &&
    !/^ARCHITECT_AGENT_URL=/.test(line) &&
    !/^BUILDER_AGENT_URL=/.test(line) &&
    !/^DEVOPS_AGENT_URL=/.test(line) &&
    !/^MEMORY_AGENT_URL=/.test(line) &&
    !/^DOCUMENTATION_SERVICE_URL=/.test(line) &&
    !/^MONITOR_AGENT_URL=/.test(line) &&
    !/^BROWSER_TESTING_AGENT_URL=/.test(line) &&
    !/^FILE_ASSET_SERVICE_URL=/.test(line) &&
    !/^MONITOR_INTERVAL_MS=/.test(line),
);

for (const s of LOCAL_SERVICES) {
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
