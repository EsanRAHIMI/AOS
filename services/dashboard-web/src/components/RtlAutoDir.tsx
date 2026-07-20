'use client';

/**
 * App-wide RTL enhancer for opt-in surfaces and form fields.
 *
 * IMPORTANT: never mutate React-managed DOM during Next.js concurrent
 * hydration. Scanning `.main`/`.card` while Suspense islands still hydrate
 * caused systematic `dir="rtl"` hydration mismatches (server DOM mutated
 * before client fibers finished). Direction for page content must come from
 * React via `dirProps` / `<AutoDir>` so SSR HTML matches the client VDOM.
 *
 * This enhancer only:
 *   1. Handles inputs/textareas (user typing after hydrate)
 *   2. Enhances subtrees marked `[data-rtl-root]` (explicit opt-in)
 * and only after `window` `load` + idle — well past hydration.
 */
import { useEffect } from 'react';
import { containsRtl } from '@/lib/rtl';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'CANVAS', 'VIDEO', 'AUDIO',
  'IMG', 'BUTTON', 'SELECT', 'OPTION', 'CODE', 'KBD', 'SAMP',
]);

const PHRASING = new Set([
  'BR', 'SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'MARK', 'SMALL', 'WBR',
  'ABBR', 'TIME', 'SUB', 'SUP', 'CODE',
]);

function isSkippable(el: HTMLElement): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.closest('[data-no-auto-dir]')) return true;
  if (el.isContentEditable) return true;
  if (el.hasAttribute('data-auto-dir')) return true;
  return false;
}

function isTextContainer(el: HTMLElement): boolean {
  if (isSkippable(el)) return false;
  let hasText = false;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? '').trim()) hasText = true;
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (!PHRASING.has(tag)) return false;
      if ((child.textContent ?? '').trim()) hasText = true;
    }
  }
  return hasText;
}

function applyDir(el: HTMLElement): void {
  if (isSkippable(el)) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const value = el.value || el.placeholder || '';
    if (containsRtl(value)) {
      if (el.getAttribute('dir') !== 'rtl') el.setAttribute('dir', 'rtl');
    } else if (el.getAttribute('dir') === 'rtl' && !el.hasAttribute('data-auto-dir')) {
      el.removeAttribute('dir');
    }
    return;
  }

  if (!isTextContainer(el)) return;
  const sample = (el.textContent ?? '').trim();
  if (!sample) return;

  if (containsRtl(sample)) {
    if (el.getAttribute('dir') !== 'rtl') el.setAttribute('dir', 'rtl');
  } else if (el.getAttribute('dir') === 'rtl' && !el.hasAttribute('data-auto-dir')) {
    el.removeAttribute('dir');
  }
}

function scanOptIn(root: ParentNode): void {
  const scope = root instanceof Document ? root.body : root;
  if (!scope || !('querySelectorAll' in scope)) return;

  for (const el of scope.querySelectorAll<HTMLElement>('input, textarea')) {
    applyDir(el);
  }

  for (const surface of scope.querySelectorAll<HTMLElement>('[data-rtl-root]')) {
    applyDir(surface);
    for (const node of surface.querySelectorAll<HTMLElement>('*')) {
      if (isTextContainer(node)) applyDir(node);
    }
  }
}

function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => cb(), { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(cb, 400);
  return () => window.clearTimeout(t);
}

export function RtlAutoDir() {
  useEffect(() => {
    let cancelled = false;
    let mo: MutationObserver | null = null;
    let cancelIdle: (() => void) | null = null;

    const arm = () => {
      if (cancelled) return;
      scanOptIn(document);

      mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target.parentElement) {
            const host = m.target.parentElement.closest('[data-rtl-root], input, textarea');
            if (host instanceof HTMLElement) applyDir(m.target.parentElement);
            continue;
          }
          if (m.type === 'childList') {
            for (const n of m.addedNodes) {
              if (!(n instanceof HTMLElement)) continue;
              if (n.matches?.('input, textarea') || n.closest?.('[data-rtl-root]')) {
                applyDir(n);
                scanOptIn(n);
              }
            }
          }
          if (m.type === 'attributes' && m.target instanceof HTMLElement) {
            if (m.attributeName === 'value' || m.attributeName === 'placeholder') applyDir(m.target);
          }
        }
      });

      mo.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['value', 'placeholder'],
      });
    };

    const start = () => {
      cancelIdle = whenIdle(arm);
    };

    // Past full load → concurrent hydration of streamed islands is done.
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) applyDir(t);
    };
    document.addEventListener('input', onInput, true);

    return () => {
      cancelled = true;
      cancelIdle?.();
      mo?.disconnect();
      document.removeEventListener('input', onInput, true);
      window.removeEventListener('load', start);
    };
  }, []);

  return null;
}
