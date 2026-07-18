#!/usr/bin/env node
/**
 * Real model provider health check (K2 Product Activation, D-178).
 *
 * Resolves the model registry exactly as the gateway does and performs a REAL
 * request against the configured provider — a local OpenAI-compatible endpoint
 * (Ollama/vLLM/LM Studio) or a cloud key. Prints the provider, tier models,
 * local/cloud/degraded state, and whether a live probe succeeded.
 *
 * Usage (local, recommended — no paid API):
 *   # start Ollama and pull a tool-capable model, e.g.:
 *   #   ollama serve &
 *   #   ollama pull qwen2.5:7b        # or llama3.1:8b, mistral-nemo, etc.
 *   LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 LLM_LOCAL_MODEL=qwen2.5:7b \
 *     node scripts/model-health-check.mjs
 *
 * Cloud (optional, host api.anthropic.com is reachable from this environment):
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/model-health-check.mjs
 */
import { modelRegistryFromEnv, probeModelProvider } from '@factory/shared';

const reg = modelRegistryFromEnv(process.env);
console.log('provider   :', reg.provider);
console.log('isLocal    :', reg.isLocal);
console.log('baseUrl    :', reg.baseUrl || '(n/a)');
console.log('models     :', JSON.stringify(reg.models));
console.log('degraded   :', reg.provider === 'none');

if (reg.provider === 'none') {
  console.log('\nDEGRADED — no model provider configured. Jarvis will answer from real');
  console.log('stored data only (deterministic). Set LLM_LOCAL_BASE_URL (self-hosted,');
  console.log('recommended) or a provider key to enable reasoning + native tool calling.');
  process.exit(2);
}

const probe = await probeModelProvider(reg, 15000);
console.log('\nprobe.ok   :', probe.ok);
console.log('probe.detail:', probe.detail);
process.exit(probe.ok ? 0 : 1);
