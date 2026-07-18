'use client';

/**
 * App-wide RTL enhancer: after React hydration, any text block that contains
 * Persian/Arabic (or other RTL scripts) gets `dir="rtl"` so it right-aligns.
 *
 * Must NOT mutate the DOM during hydration — that causes React mismatch errors.
 * Opt out with `data-no-auto-dir` on an ancestor (chrome, nav, monospace logs).
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
  // Never override an explicit React-managed dir.
  if (el.hasAttribute('data-auto-dir')) return true;
  return false;
}

/** Element whose meaningful content is text / phrasing — safe for dir=. */
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

/**
 * Only add `dir="rtl"` when RTL script is present. Never write `dir="ltr"` —
 * LTR is the document default and mutating it before/after hydrate causes noise
 * and hydration mismatches.
 */
function applyDir(el: HTMLElement): void {
  if (isSkippable(el)) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const value = el.value || el.placeholder || '';
    if (containsRtl(value)) {
      if (el.getAttribute('dir') !== 'rtl') el.setAttribute('dir', 'rtl');
    } else if (el.getAttribute('dir') === 'rtl') {
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

function scan(root: ParentNode): void {
  const scope = root instanceof Document ? root.body : root;
  if (!scope || !('querySelectorAll' in scope)) return;

  const nodes = scope.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, label, textarea, input, pre, ' +
      '.sub, .m, .ti .msg, .feed > div, [data-auto-dir]',
  );
  for (const el of nodes) applyDir(el);

  const surfaces = scope.querySelectorAll<HTMLElement>('.main, .card, .glass, [data-rtl-root]');
  for (const surface of surfaces) {
    for (const node of surface.querySelectorAll<HTMLElement>('*')) {
      if (isTextContainer(node)) applyDir(node);
    }
  }
}

export function RtlAutoDir() {
  useEffect(() => {
    let cancelled = false;
    let mo: MutationObserver | null = null;
    let raf2 = 0;

    const armObserver = () => {
      if (cancelled) return;
      scan(document);

      mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData' && m.target.parentElement) {
            applyDir(m.target.parentElement);
            continue;
          }
          if (m.type === 'childList') {
            for (const n of m.addedNodes) {
              if (n instanceof HTMLElement) {
                applyDir(n);
                scan(n);
              } else if (n.parentElement) {
                applyDir(n.parentElement);
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

    // Double-rAF: wait until after paint + nested client hydration passes.
    // Mutating `dir` during hydration is what triggered the mismatch warning.
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(armObserver);
    });

    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) applyDir(t);
    };
    document.addEventListener('input', onInput, true);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      mo?.disconnect();
      document.removeEventListener('input', onInput, true);
    };
  }, []);

  return null;
}
