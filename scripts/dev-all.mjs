#!/usr/bin/env node
/**
 * Run all local services in README-SETUP.md deploy order.
 * Invoked by: pnpm dev:all (after sync:env + build:deps).
 */
import concurrently from 'concurrently';
import { LOCAL_SERVICES } from './local-services.mjs';

const commands = LOCAL_SERVICES.map((s) => ({
  command: `pnpm --filter ${s.pkg} run dev`,
  name: s.alias,
  prefixColor: s.color,
}));

const { result } = concurrently(commands, {
  killOthersOn: [],
});

result.catch((err) => {
  console.error(err);
  process.exit(1);
});
