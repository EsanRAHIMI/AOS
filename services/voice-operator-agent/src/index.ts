/**
 * Voice Operator Agent (Phase 18) — the realtime voice brain.
 *
 * Responsibilities: mint a SHORT-LIVED ephemeral realtime token (server-side; the
 * raw API key never reaches the browser), produce context-grounded plain-language
 * explanations (LLM optional, deterministic router fallback), and extract memory +
 * learning from a finished session. It NEVER mutates kernel state — the gateway's
 * voice endpoints route every action through RBAC / safe mode / approvals.
 */
import {
  loadEnv, BaseEnvSchema, MongoEnvSchema, LlmEnvSchema, connectMongo, collection, COLLECTIONS, EVENT_TYPES,
  startAgentRun, finishAgentRun, deriveVoiceLearning, VOICE_GUARDRAILS,
  type VoiceMemory, type VoiceLearningEvent,
} from '@factory/shared';
import { createFactoryService, type TaskHandler } from '@factory/service-kit';
import { manifest } from './factory/manifest.js';

const env = loadEnv(BaseEnvSchema.merge(MongoEnvSchema).merge(LlmEnvSchema));

function voiceConfigured(): boolean {
  return Boolean(process.env.VOICE_PROVIDER && process.env.OPENAI_API_KEY && (process.env.VOICE_MODEL || '').length > 0);
}

export interface RealtimeTokenResult {
  ok: boolean;
  clientSecret?: string;
  model?: string;
  expiresAt?: number;
  /** 'ga' → /v1/realtime/{client_secrets,calls}; 'beta' → /v1/realtime/{sessions,?model=} */
  apiVariant?: 'ga' | 'beta';
  /** Hard cap the client must enforce (seconds); the ephemeral token itself also expires. */
  maxSessionSeconds?: number;
  error?: string;
}

const maxSessionSeconds = (): number => {
  const secs = Number(process.env.VOICE_SESSION_MAX_SECONDS ?? NaN);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 3600);
  const mins = Number(process.env.VOICE_MAX_SESSION_MINUTES ?? NaN);
  if (Number.isFinite(mins) && mins > 0) return Math.min(mins * 60, 3600);
  return 600;
};

/**
 * Mint an OpenAI realtime ephemeral client secret without exposing the API key.
 * Tries the GA endpoint (POST /v1/realtime/client_secrets) first, then falls back
 * to the beta endpoint (POST /v1/realtime/sessions) — calibration-tolerant, no
 * fabrication: if neither responds, we report a clean provider error.
 */
async function mintRealtimeToken(): Promise<RealtimeTokenResult> {
  if (!voiceConfigured()) return { ok: false, error: 'voice provider not configured' };
  const model = process.env.VOICE_MODEL as string;
  const voice = process.env.VOICE_NAME ?? 'alloy';
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  // GA shape
  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST', headers,
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: Math.min(maxSessionSeconds(), 7200) }, session: { type: 'realtime', model, audio: { output: { voice } } } }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const body = (await res.json()) as { value?: string; expires_at?: number; session?: { model?: string } };
      if (body.value) return { ok: true, clientSecret: body.value, model: body.session?.model ?? model, expiresAt: body.expires_at, apiVariant: 'ga', maxSessionSeconds: maxSessionSeconds() };
    } else if (res.status !== 404) {
      return { ok: false, error: `realtime client_secrets ${res.status}` };
    }
  } catch { /* fall through to beta */ }
  // Beta fallback
  try {
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST', headers: { ...headers, 'openai-beta': 'realtime=v1' },
      body: JSON.stringify({ model, voice }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `realtime session ${res.status}` };
    const body = (await res.json()) as { client_secret?: { value?: string; expires_at?: number }; model?: string };
    const secret = body.client_secret?.value;
    if (!secret) return { ok: false, error: 'no client secret returned' };
    return { ok: true, clientSecret: secret, model: body.model ?? model, expiresAt: body.client_secret?.expires_at, apiVariant: 'beta', maxSessionSeconds: maxSessionSeconds() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'realtime mint failed' };
  }
}

const handleTask: TaskHandler = async (req, ctx) => {
  const taskId = req.taskId ?? 'voice';
  const input = (req.input ?? {}) as { action?: string; sessionId?: string; userId?: string; messages?: Array<{ direction: string; text: string }>; toolCalls?: Array<{ toolName: string; status: string }> };
  const action = input.action ?? 'status';
  const runId = await startAgentRun({ agentId: manifest.serviceId, serviceId: manifest.serviceId, taskId });

  if (action === 'realtime_token') {
    const tok = await mintRealtimeToken();
    await finishAgentRun(runId, { status: 'succeeded', summary: `realtime token ${tok.ok ? 'issued' : 'unavailable'}` });
    // Never log the secret.
    return { taskId, accepted: true, agentRunId: runId, realtime: { ok: tok.ok, model: tok.model, expiresAt: tok.expiresAt, apiVariant: tok.apiVariant, maxSessionSeconds: tok.maxSessionSeconds, error: tok.error, clientSecret: tok.clientSecret } };
  }

  if (action === 'derive_learning') {
    const { event, memories } = deriveVoiceLearning({ sessionId: input.sessionId ?? 'unknown', userId: input.userId ?? 'unknown', messages: input.messages ?? [], toolCalls: (input.toolCalls ?? []) as Array<{ toolName: string; status: string }> });
    await collection<VoiceLearningEvent>(COLLECTIONS.VOICE_LEARNING_EVENTS).insertOne(event);
    if (memories.length) await collection<VoiceMemory>(COLLECTIONS.VOICE_MEMORIES).insertMany(memories);
    await finishAgentRun(runId, { status: 'succeeded', summary: event.summary });
    await ctx.publisher.publish({ type: EVENT_TYPES.VOICE_LEARNED, taskId: null, payload: { sessionId: event.sessionId, lessons: event.lessons.length, message: 'Voice session learning stored' } });
    return { taskId, accepted: true, agentRunId: runId, learning: { event, memoryCount: memories.length } };
  }

  // status / capability
  await finishAgentRun(runId, { status: 'succeeded', summary: 'voice operator status' });
  return { taskId, accepted: true, agentRunId: runId, status: { configured: voiceConfigured(), provider: process.env.VOICE_PROVIDER ?? 'text', model: process.env.VOICE_MODEL ?? '', pushToTalk: (process.env.VOICE_REQUIRE_PUSH_TO_TALK ?? 'true') !== 'false', guardrails: VOICE_GUARDRAILS } };
};

async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const service = await createFactoryService({
    manifest, port: env.SERVICE_PORT, internalToken: env.FACTORY_INTERNAL_TOKEN, adminToken: env.FACTORY_ADMIN_TOKEN,
    registryUrl: env.SERVICE_REGISTRY_URL, eventBusUrl: env.EVENT_BUS_URL, logLevel: env.LOG_LEVEL, taskHandler: handleTask,
  });
  await service.listen();
}

main().catch((err) => { console.error('fatal startup error', err); process.exit(1); });
