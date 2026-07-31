#!/usr/bin/env node
/** Read-only Phase 2 preflight for local development and deployed environments. */
import {
  assessRuntimeConfiguration,
  closeMongo,
  connectMongo,
  createRedisBackbone,
  modelRegistryFromEnv,
  probeModelProvider,
  runtimeConfigurationExitCode,
  vaultAvailability,
} from '@factory/shared';

const strict = process.argv.includes('--strict');
const live = !process.argv.includes('--config-only');
const config = assessRuntimeConfiguration(process.env);
const liveChecks = [];

function safeDetail(value) {
  return String(value ?? 'unknown error')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted MongoDB URI]')
    .replace(/rediss?:\/\/[^\s]+/gi, '[redacted Redis URI]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{8,}\b/g, '[redacted credential]')
    .replace(/\borg-[A-Za-z0-9_-]+\b/g, '[redacted organization]')
    .slice(0, 240);
}

function print(check) {
  const mark = check.status === 'ready' ? 'READY  ' : check.status === 'warning' ? 'WARN   ' : 'BLOCKED';
  console.log(`${mark}  ${check.id.padEnd(22)} ${check.summary}`);
  if (check.action) console.log(`         action: ${check.action}`);
}

async function probeMongo() {
  try {
    const db = await connectMongo({
      uri: process.env.MONGODB_URI,
      dbName: process.env.MONGODB_DB_NAME || 'autonomous_os_kernel',
    });
    await db.command({ ping: 1 });
    const grant = await db.collection('google_tokens').findOne(
      { actorId: 'owner', provider: 'google' },
      { projection: { _id: 0, revokedAt: 1, refreshTokenEnc: 1 } },
    );
    liveChecks.push({ id: 'mongodb_live', status: 'ready', summary: 'MongoDB accepted a real ping.', action: '' });
    const vault = vaultAvailability(process.env);
    const grantReady = vault.configured && Boolean(grant?.refreshTokenEnc) && !grant?.revokedAt;
    liveChecks.push({
      id: 'google_grant_live', status: grantReady ? 'ready' : 'warning',
      summary: grantReady ? 'An encrypted, active Google grant exists.' : 'OAuth config exists, but no active encrypted owner grant was found.',
      action: grantReady ? '' : 'Connect or reconnect Google Calendar from the dashboard, then rerun this check.',
    });
  } catch (error) {
    liveChecks.push({ id: 'mongodb_live', status: 'blocked', summary: `MongoDB probe failed: ${safeDetail(error instanceof Error ? error.message : error)}`, action: 'Check Atlas network access, DNS and credentials.' });
  } finally {
    await closeMongo().catch(() => undefined);
  }
}

async function probeRedis() {
  const redis = createRedisBackbone({ url: process.env.REDIS_URL || '', keyPrefix: process.env.REDIS_KEY_PREFIX || 'factory:' });
  const ok = await redis.ping();
  await redis.quit();
  liveChecks.push({ id: 'redis_live', status: ok ? 'ready' : 'blocked', summary: ok ? 'Redis accepted a real PING.' : 'Redis did not answer PING.', action: ok ? '' : 'Check host firewall, TLS scheme and Redis credentials.' });
}

async function probeModel() {
  const registry = modelRegistryFromEnv(process.env);
  if (registry.provider === 'none') {
    liveChecks.push({ id: 'model_live', status: 'blocked', summary: 'No model provider resolved.', action: 'Configure a model provider.' });
    return;
  }
  const result = await probeModelProvider(registry, 15_000);
  liveChecks.push({
    id: 'model_live', status: result.ok ? 'ready' : 'blocked',
    summary: result.ok ? `Model provider ${registry.provider} completed a real probe.` : `Model probe failed: ${safeDetail(result.detail)}`,
    action: result.ok ? '' : 'Verify provider reachability, model id, quota and API credentials.',
  });
}

console.log(`AOS runtime readiness (${live ? 'config + live probes' : 'config only'})\n`);
config.forEach(print);

if (live && !config.some((c) => c.id === 'mongo_config' && c.status === 'blocked')) await probeMongo();
if (live && !config.some((c) => c.id === 'redis_config' && c.status === 'blocked')) await probeRedis();
if (live && !config.some((c) => c.id === 'model_config' && c.status === 'blocked')) await probeModel();

if (liveChecks.length) {
  console.log('');
  liveChecks.forEach(print);
}

const all = [...config, ...liveChecks];
const code = runtimeConfigurationExitCode(all, strict);
console.log(`\nsummary: ${all.filter((c) => c.status === 'ready').length} ready, ${all.filter((c) => c.status === 'warning').length} warning, ${all.filter((c) => c.status === 'blocked').length} blocked`);
process.exit(code);
