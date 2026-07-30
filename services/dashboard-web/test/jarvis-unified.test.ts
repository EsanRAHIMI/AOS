/**
 * D-190 — there is exactly ONE conversation implementation.
 *
 * This is a structural test, not a render test, because the defect it guards
 * is structural: the dock and the `/jarvis` stage each had their own message
 * list, streaming loop, approval bar and composer. They shared a session, so
 * the DATA looked unified while the BEHAVIOUR drifted — history loading landed
 * in one, the structured renderer in one, and the approval UI differed. A
 * second copy is easy to reintroduce and hard to notice, so it fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

const dock = src('components/JarvisDock.tsx');
const stage = src('app/jarvis/JarvisWorkspace.tsx');
const conversation = src('components/JarvisConversation.tsx');

describe('one conversation, every surface', () => {
  it('both surfaces render the shared component', () => {
    expect(dock).toContain('<JarvisConversation');
    expect(stage).toContain('<JarvisConversation');
  });

  it('only the shared component talks to the streaming route', () => {
    expect(conversation).toContain('/api/jarvis-stream');
    expect(dock).not.toContain('/api/jarvis-stream');
    expect(stage).not.toContain('/api/jarvis-stream');
  });

  it('only the shared component sends turns or decides approvals', () => {
    for (const [name, file] of [['dock', dock], ['stage', stage]] as const) {
      expect(file, `${name} must not send turns itself`).not.toContain('sendTurnAction(');
      expect(file, `${name} must not decide approvals itself`).not.toContain('decideApprovalAction(');
    }
    expect(conversation).toContain('sendTurnAction(');
    expect(conversation).toContain('decideApprovalAction(');
  });

  it('only the shared component renders replies, so structure cannot diverge', () => {
    expect(conversation).toContain('<RichText');
    expect(dock).not.toContain('<RichText');
    expect(stage).not.toContain('<RichText');
  });

  it('loads real history rather than starting empty', () => {
    expect(conversation).toContain('getSessionAction');
    expect(conversation).toContain('HISTORY_TURNS');
  });

  it('is a centred floating surface, not a corner widget', () => {
    // A native <dialog> puts it in the top layer, centred, above any page.
    expect(dock).toContain('<dialog');
    expect(dock).toContain('showModal()');
    expect(dock).toContain('jdock-modal');
  });

  it('still hides itself on /jarvis — the one place two inputs would be wrong', () => {
    expect(dock).toContain("pathname === '/jarvis'");
  });

  it('passes the current page as context so "open this" means something', () => {
    expect(dock).toContain('current page:');
    expect(conversation).toContain('contextNote');
  });
});
