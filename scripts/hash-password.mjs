#!/usr/bin/env node
/**
 * Generate a scrypt password hash for the dashboard login.
 * Usage:  node scripts/hash-password.mjs 'your-password'
 * Output: scrypt$<saltHex>$<hashHex>  → paste into DASHBOARD_*_PASSWORD_HASH
 */
import { scryptSync, randomBytes } from 'node:crypto';

const pw = process.argv[2];
if (!pw) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 32);
process.stdout.write(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}\n`);
