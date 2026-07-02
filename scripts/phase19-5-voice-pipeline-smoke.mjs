#!/usr/bin/env node
/**
 * Phase 19.5 smoke — voice command pipeline (gate + router + language).
 * Compiles the client UtteranceGate standalone and drives it with a fake clock,
 * then verifies the operator-language router. No network, no browser.
 * Run from repo root: node scripts/phase19-5-voice-pipeline-smoke.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('Phase 19.5 — voice pipeline smoke\n');

// ---- compile the dependency-free client gate to plain ESM ----
const out = mkdtempSync(join(tmpdir(), 'gate-'));
execSync(`npx tsc services/dashboard-web/src/lib/utteranceGate.ts --target es2022 --module es2022 --moduleResolution bundler --outDir ${out}`, { stdio: 'inherit' });
const { UtteranceGate, normalizeUtterance: clientNorm, DEFAULT_GATE_CONFIG } = await import(pathToFileURL(join(out, 'utteranceGate.js')).href);
const { routeUtterance, normalizeUtterance: sharedNorm, VOICE_GUARDRAILS } = await import('../shared/dist/voice/index.js');

// Fake clock
let t = 1_000_000;
const now = () => t;

console.log('— UtteranceGate —');
check('Config: finalOnly=true, minCommandChars=4, dedupeWindowMs=5000',
  DEFAULT_GATE_CONFIG.finalOnly === true && DEFAULT_GATE_CONFIG.minCommandChars === 4 && DEFAULT_GATE_CONFIG.dedupeWindowMs === 5000);

// Scenario A — partial transcripts never submit; final submits once.
{
  const g = new UtteranceGate({}, now);
  const submitted = [];
  for (const [text, final] of [['Check', false], ['Check the', false], ['Check the', false], ['Check the system', false], ['Check the system', true]]) {
    const v = g.evaluate(text, final);
    if (v.accept) { submitted.push(text); g.markSubmitted(text); g.markHandled(); }
  }
  check('A: interim transcripts rejected; exactly one submit with final text', submitted.length === 1 && submitted[0] === 'Check the system');
}

// Scenario C — duplicate final within window ignored; accepted after window.
{
  const g = new UtteranceGate({}, now);
  const v1 = g.evaluate('Check the system', true); g.markSubmitted('Check the system'); g.markHandled();
  t += 1000;
  const v2 = g.evaluate('Check the system', true);
  t += 6000;
  const v3 = g.evaluate('Check the system', true);
  check('C: duplicate within 5s rejected, after window accepted', v1.accept && !v2.accept && v2.reason === 'duplicate' && v3.accept);
  check('C: punctuation/case do not defeat dedupe', clientNorm('Check the system.') === clientNorm('check   the SYSTEM'));
}

// Single in-flight lock — no queueing while thinking/executing.
{
  const g = new UtteranceGate({}, now);
  g.markSubmitted('check the system');
  const v = g.evaluate('run a security check', true);
  g.markHandled();
  const v2 = g.evaluate('run a security check', true);
  check('Lock: command during in-flight rejected as busy; accepted after handled', !v.accept && v.reason === 'busy' && v2.accept);
}

// Scenario B — echo: assistant speech is not reprocessed as user input.
{
  const g = new UtteranceGate({}, now);
  g.markSpeaking(true);
  const during = g.evaluate('I will check the system', true);
  g.markSpeaking(false);
  t += 100; // inside echoGuardMs
  const justAfter = g.evaluate('I will check the system', true);
  t += 500; // outside guard
  const later = g.evaluate('and now a real command', true);
  check('B: voice input during speaking rejected as echo', !during.accept && during.reason === 'echo');
  check('B: voice input within echoGuardMs after speaking rejected', !justAfter.accept && justAfter.reason === 'echo');
  check('B: voice input after guard window accepted', later.accept);
  const typedDuring = (() => { g.markSpeaking(true); return g.evaluate('typed command here', true, { voice: false }); })();
  check('B: typed input is never treated as echo', typedDuring.accept);
  g.markSpeaking(false);
}

// Short fragments ignored.
{
  const g = new UtteranceGate({}, now);
  check('Fragments < 4 chars rejected', !g.evaluate('go', true).accept && !g.evaluate('a', true).accept && !g.evaluate('   ', true).accept);
}

// Assistant response dedupe.
{
  const g = new UtteranceGate({}, now);
  const a1 = g.acceptAssistant('No operation is executing.');
  const a2 = g.acceptAssistant('No operation is executing.');
  t += 6000;
  const a3 = g.acceptAssistant('No operation is executing.');
  check('Assistant: identical reply suppressed within window, allowed after', a1 && !a2 && a3);
}

// Scenario D — interrupt resets cleanly.
{
  const g = new UtteranceGate({}, now);
  g.markSubmitted('check the system');
  g.markSpeaking(true);
  g.reset(); // = interrupt
  const v = g.evaluate('new command now', true);
  check('D: after interrupt/reset the gate accepts a new command immediately', v.accept && !g.busy && !g.speaking);
}

// No double-submit across sources: same text via realtime then browser STT.
{
  const g = new UtteranceGate({}, now);
  const rt = g.evaluate('check gateway health', true); g.markSubmitted('check gateway health'); g.markHandled();
  t += 800;
  const stt = g.evaluate('check gateway health', true);
  check('Realtime + browser fallback cannot double-submit the same command', rt.accept && !stt.accept && stt.reason === 'duplicate');
}

// Normalization parity client ↔ server (gateway dedupe agrees with client).
check('normalizeUtterance parity (client == shared/gateway)',
  ['Check the system.', '  RESTART   the Gateway!! ', 'čeck ünïcode'].every((s) => clientNorm(s) === sharedNorm(s)));

console.log('— Router / operator language —');
// Scenario E — "Check the system" → specific read-only proposal with confirm.
{
  const p = routeUtterance('Check the system.', { role: 'operator', safeMode: false });
  check('E: system check → run_system_status_check, low risk, light confirm', p.toolName === 'run_system_status_check' && p.riskLevel === 'low' && p.confirm === 'light');
  check('E: reply is short, specific, read-only, single confirm', /read-only/i.test(p.explanation) && /Confirm\?/.test(p.explanation) && p.explanation.length < 160);
}
// Fallback: echoes the heard text, no capability spam.
{
  const p = routeUtterance('flibbertigibbet the mainframe', { role: 'owner', safeMode: false });
  check('Fallback echoes heard text', p.explanation.includes('I heard:') && p.explanation.includes('flibbertigibbet'));
  check('No generic capability-list opener anywhere', !/I can explain the current page, run a read-only health check/.test(p.explanation));
}
// Safety unchanged.
{
  const core = routeUtterance('Restart the gateway.', { role: 'owner', safeMode: false });
  const safeMode = routeUtterance('redeploy the qa agent', { role: 'owner', safeMode: true });
  const del = routeUtterance('delete everything', { role: 'owner', safeMode: false });
  check('Protected core still blocked/critical/owner-only', core.blocked && core.ownerOnly && core.riskLevel === 'critical');
  check('Safe mode still blocks mutations', safeMode.blocked);
  check('Destructive still blocked', del.blocked);
  check('All 10 guardrails intact', VOICE_GUARDRAILS.length === 10);
  check('System check never routes to Dokploy ops', routeUtterance('check the system', { role: 'owner', safeMode: false }).toolName !== 'create_operation_plan');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
