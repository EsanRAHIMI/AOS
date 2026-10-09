/** The one way any control asks the assistant surface to open or toggle. */

const OPEN = 'jarvis:open';
const TOGGLE = 'jarvis:toggle';

export function openJarvis(): void {
  window.dispatchEvent(new Event(OPEN));
}

export function toggleJarvis(): void {
  window.dispatchEvent(new Event(TOGGLE));
}

export function onJarvisOpen(fn: () => void): () => void {
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

export function onJarvisToggle(fn: () => void): () => void {
  window.addEventListener(TOGGLE, fn);
  return () => window.removeEventListener(TOGGLE, fn);
}
