#!/usr/bin/env node
/**
 * Free LOCAL_SERVICES ports before `pnpm dev:all` so leftover processes from
 * earlier partial starts cannot cause EADDRINUSE.
 *
 * D-182 hardening (owner-reported recurrence): killing only the LISTENER pid
 * is not enough — `node --watch` PARENT processes survive SIGTERM of their
 * children and immediately respawn them, re-binding the port. Order matters:
 *   1. kill every `node --env-file=.env --watch` parent first (SIGKILL —
 *      watch parents ignore/no-op SIGTERM in this failure mode),
 *   2. then kill remaining listeners,
 *   3. verify each port actually released; escalate to SIGKILL if not.
 *
 * macOS/Linux only (lsof/pgrep). Safe no-op when everything is free.
 * Set DEV_FREE_PORTS=0 to skip.
 */
import { execFileSync } from 'node:child_process';
import { LOCAL_SERVICES } from './local-services.mjs';

if (process.env.DEV_FREE_PORTS === '0') {
  console.log('dev-free-ports: skipped (DEV_FREE_PORTS=0)');
  process.exit(0);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const listenerPids = (port) => run('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).split(/\s+/).filter(Boolean);
const kill = (pid, signal) => { try { process.kill(Number(pid), signal); return true; } catch { return false; } };

const ports = [...new Set(LOCAL_SERVICES.map((s) => s.port))].sort((a, b) => a - b);
const self = String(process.pid);
let killed = 0;

// 1) Watch parents first — otherwise they respawn listeners faster than we
//    free ports. Match the exact dev invocation shape used by dev-all.
const watchParents = run('pgrep', ['-f', 'node --env-file=.env --watch'])
  .split(/\s+/).filter((pid) => pid && pid !== self);
for (const pid of watchParents) {
  if (kill(pid, 'SIGKILL')) {
    killed += 1;
    console.log(`dev-free-ports: SIGKILL watch parent ${pid}`);
  }
}
if (watchParents.length) sleep(300);

// 2) Remaining listeners on our ports.
for (const port of ports) {
  for (const pid of listenerPids(port)) {
    if (kill(pid, 'SIGTERM')) {
      killed += 1;
      console.log(`dev-free-ports: SIGTERM pid ${pid} on :${port}`);
    }
  }
}

// 3) Verify release; escalate stragglers (or freshly respawned children).
if (killed > 0) {
  sleep(500);
  for (const port of ports) {
    for (const pid of listenerPids(port)) {
      if (kill(pid, 'SIGKILL')) console.log(`dev-free-ports: SIGKILL straggler ${pid} on :${port}`);
    }
  }
  sleep(200);
}

const stillBusy = ports.filter((p) => listenerPids(p).length > 0);
if (killed === 0) console.log('dev-free-ports: all local ports free');
else if (stillBusy.length === 0) console.log(`dev-free-ports: freed ${killed} process(es); all ports released`);
else {
  console.error(`dev-free-ports: ports still busy after escalation: ${stillBusy.join(', ')}`);
  process.exit(1);
}
