/**
 * Live turn progress from the loop (D-213).
 *
 * The failure this replaces was structural, not cosmetic: `runId` did not
 * exist outside the loop until the turn had already finished, so the streaming
 * endpoint had nothing to poll against and flushed everything at the end. The
 * ordering assertions below are therefore the real contract — `run.started`
 * must precede every other delta, or nothing built on it works.
 *
 * The loop, governance and persistence are real (against the fake db); only
 * the model transport is scripted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { setTestDb } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.js';
import {
  AgentToolRegistry, startAgentLoop,
  type AgentLoopOptions, type LoopDelta,
} from '../src/agentcore/index.js';
import type { ChatDelta, ChatRequest, ChatResult, ToolCallingProvider } from '../src/llm/toolcalling.js';

/** Transport with no streaming support — the pre-existing shape. */
class PlainProvider implements ToolCallingProvider {
  readonly name = 'plain';
  public calls = 0;
  constructor(private script: Array<Partial<ChatResult>>) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls += 1;
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    return { text: '', toolCalls: [], tokensIn: 5, tokensOut: 5, costUsd: 0.001, model: req.model, provider: this.name, ...next };
  }
}

/** Transport that streams; `chat` throws so a wrong branch cannot pass. */
class StreamingProvider implements ToolCallingProvider {
  readonly name = 'streaming';
  constructor(private script: Array<Partial<ChatResult>>) {}
  async chat(): Promise<ChatResult> {
    throw new Error('chat() must not be used when chatStream() exists and a listener is attached');
  }
  async chatStream(req: ChatRequest, onDelta: (d: ChatDelta) => void): Promise<ChatResult> {
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    for (const ch of (next.text ?? '')) onDelta({ kind: 'text', text: ch });
    for (const c of next.toolCalls ?? []) onDelta({ kind: 'tool.start', toolName: c.toolName, callId: c.callId });
    return { text: '', toolCalls: [], tokensIn: 5, tokensOut: 5, costUsd: 0.001, model: req.model, provider: this.name, ...next };
  }
}

function registry(): AgentToolRegistry {
  const r = new AgentToolRegistry();
  r.register({
    definition: {
      name: 'read_notes', version: '1.0.0', purpose: 'read notes', family: 'test', ownerModule: 'test',
      inputFields: {}, outputFields: {}, requiredActorScope: 'user', permission: '', riskLevel: 'low',
      policyCategory: 'read_only', requiresApproval: false, ownerOnly: false, timeoutMs: 3000, maxRetries: 0,
      idempotent: true, sideEffect: 'none', evidenceRequired: false, rollbackAvailable: false,
      outputTrust: 'trusted_internal', available: true, unavailableReason: '',
    },
    inputSchema: z.object({ topic: z.string() }),
    executor: async (args) => ({ ok: true, summary: `notes about ${args.topic}` }),
  });
  return r;
}

const actor = { actorId: 'esan', role: 'owner', isOwner: true, scope: 'user' as const, tenantId: null, userId: 'esan' };

function opts(provider: ToolCallingProvider, extra: Partial<AgentLoopOptions> = {}): AgentLoopOptions {
  return {
    role: 'jarvis', goal: 'test goal', systemPrompt: 'sys', contextText: 'CTX',
    registry: registry(), grants: '*', actor, provider, model: 'fake-model',
    reasoningMode: 'native', maxSteps: 6, timeoutMs: 30000, maxCostUsd: 1,
    sessionId: 'sess1', turnId: 'turn1', ...extra,
  };
}

describe('agent loop — live deltas', () => {
  beforeEach(() => { setTestDb(createFakeDb().db); });

  it('emits run.started with a usable id before anything else happens', async () => {
    const seen: LoopDelta[] = [];
    const out = await startAgentLoop(opts(new StreamingProvider([{ text: 'hi' }]), {
      onDelta: (d) => seen.push(d),
    }));

    // First, and before any model call: this is the id a cancel needs, and
    // its absence was the reason the old endpoint could not stream at all.
    expect(seen[0]).toEqual({ kind: 'run.started', runId: out.run.runId });
    expect(seen.filter((d) => d.kind === 'run.started')).toHaveLength(1);
  });

  it('streams text, then reports each tool call ending, in the order they happened', async () => {
    const seen: LoopDelta[] = [];
    await startAgentLoop(opts(
      new StreamingProvider([
        { text: 'ok', toolCalls: [{ callId: 'c1', toolName: 'read_notes', args: { topic: 'gym' } }] },
        { text: 'done' },
      ]),
      { onDelta: (d) => seen.push(d) },
    ));

    const kinds = seen.map((d) => d.kind);
    expect(kinds[0]).toBe('run.started');
    expect(kinds).toContain('text');
    expect(kinds.indexOf('tool.start')).toBeLessThan(kinds.indexOf('tool.end'));
    expect(seen).toContainEqual({
      kind: 'tool.end', toolName: 'read_notes', callId: 'c1', ok: true,
      summary: 'notes about gym',
    });
  });

  it('a provider without chatStream still runs — streaming is optional, not required', async () => {
    const provider = new PlainProvider([{ text: 'plain answer' }]);
    const seen: LoopDelta[] = [];
    const out = await startAgentLoop(opts(provider, { onDelta: (d) => seen.push(d) }));

    expect(provider.calls).toBe(1);
    expect(out.finalText).toBe('plain answer');
    // No text deltas — but the run id still arrives, so cancel still works.
    expect(seen.filter((d) => d.kind === 'text')).toHaveLength(0);
    expect(seen[0]?.kind).toBe('run.started');
  });

  it('produces an identical outcome whether or not anyone is listening', async () => {
    const script: Array<Partial<ChatResult>> = [
      { text: 'ok', toolCalls: [{ callId: 'c1', toolName: 'read_notes', args: { topic: 'gym' } }] },
      { text: 'the notes say alpha' },
    ];

    setTestDb(createFakeDb().db);
    const withListener = await startAgentLoop(opts(new StreamingProvider([...script]), { onDelta: () => {} }));
    setTestDb(createFakeDb().db);
    const without = await startAgentLoop(opts(new PlainProvider([...script])));

    /* The whole design rests on this: deltas are a view of the run, never a
     * second path through it. Text, stop reason, step count and cost must not
     * depend on whether a socket happened to be open. */
    expect(withListener.finalText).toBe(without.finalText);
    expect(withListener.stopReason).toBe(without.stopReason);
    expect(withListener.run.steps).toBe(without.run.steps);
    expect(withListener.run.costUsd).toBeCloseTo(without.run.costUsd, 10);
  });

  it('a throwing onDelta cannot take the turn down with it', async () => {
    /* The callback is someone else's code holding a socket. If a client
     * disconnects at the wrong moment, the owner's work must still complete
     * and its side effects must still be recorded. */
    const out = await startAgentLoop(opts(new StreamingProvider([{ text: 'survived' }]), {
      onDelta: () => { throw new Error('client vanished'); },
    }));
    expect(out.finalText).toBe('survived');
    expect(out.stopReason).toBe('completed');
  });
});
