'use client';
/**
 * Jarvis presence — one live state, broadcast to whatever wants to show it
 * (D-191).
 *
 * The `/jarvis` canvas pulses with what Jarvis is doing: listening, thinking,
 * acting, speaking. It knew that because it OWNED the conversation — which is
 * exactly the duplication being removed. The conversation now lives in one
 * component, so the visual layer subscribes to its state instead of running a
 * second copy to derive it.
 *
 * A module-level emitter rather than React context on purpose: the publisher
 * (the rudder, fixed at the bottom of the layout) and the subscriber (the page
 * canvas) are in different subtrees with no common provider, and inventing one
 * would mean wrapping the whole app to move a single enum.
 */

export type JarvisPresence = 'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'error';

let current: JarvisPresence = 'idle';
const listeners = new Set<(s: JarvisPresence) => void>();

export function publishJarvisPresence(state: JarvisPresence): void {
  if (state === current) return;
  current = state;
  for (const fn of listeners) {
    try { fn(state); } catch { /* a broken listener must not stop the others */ }
  }
}

export function getJarvisPresence(): JarvisPresence {
  return current;
}

/** Returns an unsubscribe function; fires immediately with the current state. */
export function subscribeJarvisPresence(fn: (s: JarvisPresence) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}
