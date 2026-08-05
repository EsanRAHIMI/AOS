/**
 * D-191 — there is exactly ONE assistant, on every surface.
 *
 * The previous version of this test passed while `/jarvis` still had its own
 * chat, because it checked `JarvisWorkspace` — a file nothing rendered. That
 * is the lesson encoded here: **start from the route**, follow it to the
 * component it actually renders, and assert against that. A guard that checks
 * the wrong file is worse than no guard, because it reports safety.
 *
 * There were three implementations: the dock (other pages), `JarvisWorkspace`
 * (dead) and `JarvisCoreHUD` (home `/`, and the only one with the stage
 * canvas). Hence the symptom: voice on one page, history and structure on
 * the others. `/jarvis` now redirects to `/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const conversation = read('components/JarvisConversation.tsx');
const rudder = read('components/JarvisRudder.tsx');
const layout = read('app/layout.tsx');
const homePage = read('app/page.tsx');
const jarvisPage = read('app/jarvis/page.tsx');
const coreHud = read('app/jarvis/JarvisCoreHUD.tsx');
/* D-211 — the turn pipeline moved OUT of the view into module state. The
 * invariant this file protects ("one conversation, one place") is unchanged;
 * the place is now the engine, and the component is a subscriber. */
const engine = read('lib/jarvisEngine.ts');

/** Every client file that could plausibly host a chat. */
function allComponentFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) allComponentFiles(rel, acc);
    else if (entry.name.endsWith('.tsx')) acc.push(rel);
  }
  return acc;
}

describe('one assistant, everywhere', () => {
  it('the dead duplicates are gone, not merely bypassed', () => {
    expect(existsSync(join(root, 'app/jarvis/JarvisWorkspace.tsx'))).toBe(false);
    expect(existsSync(join(root, 'components/JarvisDock.tsx'))).toBe(false);
  });

  it('is mounted once in the layout, so it exists on every route', () => {
    expect(layout).toContain('<JarvisRudder');
    expect(rudder).toContain('<JarvisConversation');
  });

  it('home `/` is the Jarvis stage; legacy `/jarvis` redirects there', () => {
    expect(homePage).toContain('JarvisCoreHUD');
    expect(jarvisPage).toContain("redirect('/')");
    for (const forbidden of ['sendTurnAction', 'createSessionAction', '/api/jarvis-stream', 'SpeechRecognition']) {
      expect(coreHud, `Jarvis stage must not run its own ${forbidden}`).not.toContain(forbidden);
    }
    // It keeps its visual layer, driven by the shared presence.
    expect(coreHud).toContain('subscribeJarvisPresence');
  });

  it('no component outside the shared one talks to the turn pipeline', () => {
    const offenders: string[] = [];
    for (const file of allComponentFiles('components').concat(allComponentFiles('app'))) {
      if (file.endsWith('components/JarvisConversation.tsx')) continue;
      if (file.endsWith('lib/jarvisEngine.ts')) continue;   // D-211: the engine IS the pipeline
      const src = readFileSync(join(root, file), 'utf8');
      if (src.includes('/api/jarvis-stream') || src.includes('sendTurnAction(')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('voice belongs to the conversation, so every surface has it', () => {
    expect(conversation).toContain('useVoice');
    // …and exactly one module implements it.
    expect(existsSync(join(root, 'lib/useVoice.ts'))).toBe(true);
    expect(coreHud).not.toContain('speechSynthesis');
  });

  it('keeps history, structure and approvals in that one place', () => {
    expect(engine).toContain('getSessionAction');          // real history
    expect(conversation).toContain('<RichText');           // structured replies
    expect(conversation).toContain('decideApprovalAction'); // approval pause
  });

  /* D-211 — the reported bug was that ambient voice behaved differently
   * depending on whether the panel was open, and that one spoken sentence
   * became several turns. Both followed from the conversation OWNING the
   * pipeline while being mounted only when open. These assertions stop that
   * structure from coming back. */
  it('runs the conversation outside the component tree', () => {
    // The engine drives the stream; the view only renders it.
    expect(engine).toContain('/api/jarvis-stream');
    expect(conversation).not.toContain('/api/jarvis-stream');
    // Module-scope state, not React state: it must outlive every mount.
    expect(engine).toContain('let snapshot');
  });

  it('serialises turns, because they share one server-side transcript', () => {
    expect(engine).toContain('const queue');
    expect(engine).toContain('async function drain');
  });

  it('never lets a voice command reach the pipeline through a prop', () => {
    // The `injected={{text, nonce}}` prop re-fired its effect on every
    // remount. Voice now calls the engine directly.
    expect(rudder).toContain('submitToJarvis');
    expect(conversation).not.toContain('injected');
  });

  it('is a bottom rudder, present on every page except login', () => {
    expect(rudder).toContain('jrud');
    expect(rudder).toContain("pathname.startsWith('/login')");
    // No longer excluded from /jarvis — that exclusion was the whole problem.
    expect(rudder).not.toContain("pathname === '/jarvis'");
  });

  it('passes the current page as context so "open this" means something', () => {
    expect(rudder).toContain('current page:');
    expect(conversation).toContain('contextNote');
  });
});
