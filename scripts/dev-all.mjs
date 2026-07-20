#!/usr/bin/env node
/**
 * Run all local services in README-SETUP.md deploy order.
 * Invoked by: pnpm dev:all (after sync:env + build:deps + free-ports).
 */
import concurrently from 'concurrently';
import { LOCAL_SERVICES } from './local-services.mjs';

const commands = LOCAL_SERVICES.map((s) => ({
  command: `pnpm --filter ${s.pkg} run dev`,
  name: s.alias,
  prefixColor: s.color,
}));

const { result } = concurrently(commands, {
  // Do not cascade-kill the whole stack if one agent crashes — but a port
  // conflict should never happen after scripts/dev-free-ports.mjs.
  killOthersOn: [],
});

result.catch((err) => {
  console.error(err);
  process.exit(1);
});
