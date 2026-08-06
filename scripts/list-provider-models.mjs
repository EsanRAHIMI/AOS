#!/usr/bin/env node
/**
 * Ask the configured providers which models actually exist (D-212).
 *
 * WHY THIS EXISTS
 * ---------------
 * `DEFAULT_MODELS` in shared/src/llm/toolcalling.ts is a hardcoded table, and
 * a model string that has been superseded does not degrade — it 404s, the turn
 * fails, and the owner sees "پاسخ دریافت نشد". The failure looks like an
 * outage and is really a stale constant.
 *
 * Model line-ups move faster than this repo does, and no snapshot written into
 * a source file stays true. So instead of guessing a name, ask the provider:
 * this prints what the configured keys can actually reach, today, and shows the
 * exact env line to set. The answer comes from the API, not from a document.
 *
 * Usage:
 *   node --env-file=.env scripts/list-provider-models.mjs
 *   node --env-file=.env scripts/list-provider-models.mjs --all   (no filter)
 *
 * Exit codes: 0 = at least one provider answered · 1 = none reachable.
 */

const SHOW_ALL = process.argv.includes('--all');
const TIMEOUT_MS = 20_000;

/* Chat-capable models only, by default. A raw list is mostly embeddings,
 * moderation, transcription and image endpoints that can never serve a turn,
 * and burying six usable names in ninety is not an answer. */
const NON_CHAT = /(embedding|moderation|whisper|tts|audio|image|dall-e|realtime|transcribe|search|rerank|codex-mini)/i;

function fmt(list) {
  return list.length ? list.map((m) => `    ${m}`).join('\n') : '    (none)';
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** OpenAI-compatible: GET /models. Ollama, vLLM and LM Studio all serve it. */
async function openAiCompatible(label, baseUrl, apiKey, envPrefix) {
  const body = await getJson(`${baseUrl.replace(/\/$/, '')}/models`, {
    authorization: `Bearer ${apiKey}`,
  });
  const ids = (body.data ?? []).map((m) => m.id).filter(Boolean).sort();
  const chat = SHOW_ALL ? ids : ids.filter((id) => !NON_CHAT.test(id));
  return { label, envPrefix, all: ids, chat };
}

/** Anthropic exposes GET /v1/models with the same auth as messages. */
async function anthropic(apiKey) {
  const body = await getJson('https://api.anthropic.com/v1/models?limit=100', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });
  const ids = (body.data ?? []).map((m) => m.id).filter(Boolean).sort();
  return { label: 'anthropic', envPrefix: 'ANTHROPIC', all: ids, chat: ids };
}

const env = process.env;
const targets = [];

if (env.OPENAI_API_KEY) {
  targets.push(['openai', () => openAiCompatible('openai', 'https://api.openai.com/v1', env.OPENAI_API_KEY, 'OPENAI')]);
}
if (env.ANTHROPIC_API_KEY) {
  targets.push(['anthropic', () => anthropic(env.ANTHROPIC_API_KEY)]);
}
if (env.LLM_LOCAL_BASE_URL) {
  targets.push(['local', () => openAiCompatible('local', env.LLM_LOCAL_BASE_URL, env.LLM_LOCAL_API_KEY || 'local', 'LOCAL')]);
}

if (targets.length === 0) {
  console.error('No provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY or LLM_LOCAL_BASE_URL.');
  process.exit(1);
}

console.log(`\nProvider model discovery — ${new Date().toISOString()}\n`);

let reached = 0;
for (const [name, run] of targets) {
  try {
    const r = await run();
    reached += 1;
    console.log(`  ${r.label}  (${r.chat.length} chat-capable of ${r.all.length} total)`);
    console.log(fmt(r.chat));
    console.log(`\n    set with:  LLM_${r.envPrefix}_MODEL_STANDARD=<id>`);
    console.log(`               LLM_${r.envPrefix}_MODEL_FAST=<id>`);
    console.log(`               LLM_${r.envPrefix}_MODEL_REASONING=<id>\n`);
  } catch (e) {
    console.log(`  ${name}  UNREACHABLE — ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

/* Pricing is not discoverable from the API, and a model priced at 0 silently
 * disables every cost budget in the loop — the run never trips maxCostUsd and
 * the owner's spend cap stops existing. So say it out loud. */
console.log('  Pricing is NOT returned by these endpoints. Any model missing from');
console.log('  PRICES in shared/src/llm/toolcalling.ts costs $0 in the ledger, which');
console.log('  means maxCostUsd can never trip. Add real numbers to');
console.log('  LLM_PRICE_OVERRIDES_JSON, e.g.\n');
console.log('    LLM_PRICE_OVERRIDES_JSON={"<model-id>":[<usd-per-1M-in>,<usd-per-1M-out>]}\n');

process.exit(reached > 0 ? 0 : 1);
