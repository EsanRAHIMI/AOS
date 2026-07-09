/**
 * K1.1 contract tests — Jarvis grounding invariants (shared/src/jarvis).
 * Pins: bilingual intent fallback, context-packet ranking/capping, the
 * user_priority precedence rule (AE.1), the priority-ignored correction gate,
 * and mode routing. All pure functions — no LLM, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  detectLanguage, classifyIntentFallback, decideJarvisMode,
  buildJarvisContextPacket, composeJarvisResponseFallback, answerIgnoresStatedPriority,
  type JarvisContextFact,
} from '../src/jarvis/index.js';

const fact = (label: string, detail: string, weight: number, status: JarvisContextFact['status'] = 'known'): JarvisContextFact =>
  ({ label, detail, status, weight });

describe('detectLanguage', () => {
  it('detects Persian, English, and other', () => {
    expect(detectLanguage('وضعیت سیستم چطوره؟')).toBe('fa');
    expect(detectLanguage('what is the system status?')).toBe('en');
    expect(detectLanguage('12345 !!')).toBe('other');
  });
});

describe('classifyIntentFallback (bilingual, deterministic)', () => {
  it('classifies system status in both languages', () => {
    expect(classifyIntentFallback('check the system health please').category).toBe('system_status');
    const fa = classifyIntentFallback('وضعیت سیستم رو بگو');
    expect(fa.category).toBe('system_status');
    expect(fa.language).toBe('fa');
  });
  it('classifies approvals, finance and personal planning', () => {
    expect(classifyIntentFallback('any pending approvals?').category).toBe('approvals_tasks');
    expect(classifyIntentFallback('what is my budget this month').category).toBe('finance_ops');
    expect(classifyIntentFallback('plan my day').category).toBe('personal_life_planning');
  });
  it('never guesses wildly: unmatched text is honestly general_conversation', () => {
    const r = classifyIntentFallback('okay thanks');
    expect(r.category).toBe('general_conversation');
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe('decideJarvisMode', () => {
  it('status/meta/general are direct answers; action categories route to the planner', () => {
    expect(decideJarvisMode({ category: 'system_status', language: 'en', confidence: 1, reasoning: '' })).toBe('direct_answer');
    expect(decideJarvisMode({ category: 'general_conversation', language: 'en', confidence: 1, reasoning: '' })).toBe('direct_answer');
    expect(decideJarvisMode({ category: 'finance_ops', language: 'en', confidence: 1, reasoning: '' })).toBe('route_to_planner');
    expect(decideJarvisMode({ category: 'code_development', language: 'en', confidence: 1, reasoning: '' })).toBe('route_to_planner');
  });
});

describe('buildJarvisContextPacket', () => {
  it('ranks by weight, caps at 14, and counts statuses from the ranked set', () => {
    const facts = Array.from({ length: 20 }, (_, i) => fact(`f${i}`, `detail ${i}`, i, i % 2 === 0 ? 'known' : 'not_configured'));
    const packet = buildJarvisContextPacket({ actorName: 'Esan', isOwner: true, scope: 'user', facts });
    expect(packet.ranked).toHaveLength(14);
    expect(packet.ranked[0]!.weight).toBe(19);
    expect(packet.knownCount + packet.notConfiguredCount).toBe(14);
    expect(packet.compactSummary).toContain('Esan (owner)');
  });
  it('marks non-known statuses explicitly in the compact summary (honesty surface)', () => {
    const packet = buildJarvisContextPacket({
      actorName: 'Esan', isOwner: true, scope: 'user',
      facts: [fact('calendar', 'no connector', 5, 'not_configured')],
    });
    expect(packet.compactSummary).toContain('[not_configured]');
  });
});

describe('composeJarvisResponseFallback — user_priority precedence (AE.1)', () => {
  const packet = buildJarvisContextPacket({
    actorName: 'Esan', isOwner: true, scope: 'user',
    facts: [
      fact('user_priority', 'ship phase K1 foundation', 10),
      fact('user_blocker', 'no CI pipeline yet', 8),
      fact('top_next_action', 'write the first contract tests', 7),
      fact('system_check', '2 services degraded', 6),
    ],
  });

  it('a stated priority leads the reply and fills the structured split', () => {
    const r = composeJarvisResponseFallback({
      text: 'what should I focus on?',
      intent: { category: 'personal_life_planning', language: 'en', confidence: 0.9, reasoning: '' },
      packet,
    });
    expect(r.reply).toContain('ship phase K1 foundation');
    expect(r.primaryPriority).toBe('ship phase K1 foundation');
    expect(r.activeBlockers.length).toBeGreaterThan(0);
    expect(r.nextAction).toBe('write the first contract tests');
    expect(r.groundedIn).toContain('user_priority');
  });

  it('a pure system_status question is exempt from priority precedence', () => {
    const r = composeJarvisResponseFallback({
      text: 'system status?',
      intent: { category: 'system_status', language: 'en', confidence: 0.9, reasoning: '' },
      packet,
    });
    expect(r.reply).toMatch(/^Current status:/);
  });

  it('answers in Persian when the intent language is fa', () => {
    const r = composeJarvisResponseFallback({
      text: 'الان چیکار کنم؟',
      intent: { category: 'personal_life_planning', language: 'fa', confidence: 0.9, reasoning: '' },
      packet,
    });
    expect(r.language).toBe('fa');
    expect(r.reply).toContain('ship phase K1 foundation'); // detail quoted verbatim
    expect(r.reply).toContain('اولویت');
  });
});

describe('answerIgnoresStatedPriority — the correction gate', () => {
  const packet = buildJarvisContextPacket({
    actorName: 'Esan', isOwner: true, scope: 'user',
    facts: [fact('user_priority', 'launch the beta program this week', 10)],
  });
  it('flags an LLM reply that ignored an explicit priority', () => {
    expect(answerIgnoresStatedPriority({ reply: 'Everything is healthy.', groundedIn: ['system_check'] }, packet)).toBe(true);
  });
  it('accepts replies that ground in or quote the priority', () => {
    expect(answerIgnoresStatedPriority({ reply: 'Focus elsewhere.', groundedIn: ['user_priority'] }, packet)).toBe(false);
    expect(answerIgnoresStatedPriority({ reply: 'Your plan: launch the beta program now.', groundedIn: [] }, packet)).toBe(false);
  });
  it('never flags when no priority fact exists', () => {
    const empty = buildJarvisContextPacket({ actorName: 'E', isOwner: false, scope: 'user', facts: [] });
    expect(answerIgnoresStatedPriority({ reply: 'anything', groundedIn: [] }, empty)).toBe(false);
  });
});
