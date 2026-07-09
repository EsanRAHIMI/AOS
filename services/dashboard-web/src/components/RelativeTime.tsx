'use client';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';

/**
 * Phase AF.4.1 — hydration-safe relative time.
 *
 * Root cause of the reported hydration mismatch: `PresenceBar` (a
 * `'use client'` component fed a server-provided timestamp) called
 * `timeAgo()`/an equivalent elapsed-time computation directly in its render
 * body. That computation depends on `Date.now()`, which advances between
 * the server render pass and the client hydration pass a moment later —
 * "3s ago" on the server, "5s ago" on the client — a real value mismatch,
 * not a false positive.
 *
 * Fix: render a stable, non-time-dependent placeholder on the FIRST render
 * pass (identical on server and client, so hydration has nothing to
 * reconcile), then compute the real relative label only inside `useEffect`
 * — which never runs during SSR and only runs after hydration completes.
 * Ticks every 5s afterward so it stays live without a page refresh.
 *
 * Audited every other `timeAgo(`/`Date.now()` render-time call site in the
 * app (see docs/decision-log.md AF.4.1 entry) — every other caller is a
 * plain Server Component (no `'use client'`), so `timeAgo()` runs exactly
 * once, server-side only, with no client re-render to mismatch against.
 * This component is the one, narrowly-scoped fix the bug needed; it's also
 * exported for any future `'use client'` component that renders a
 * server-seeded timestamp, so the same mistake isn't repeated elsewhere.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = (): void => setLabel(timeAgo(iso));
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [iso]);

  // `null` on the server AND on the client's first render (both render the
  // same placeholder) — only swaps to the real value after mount.
  return <>{label ?? '…'}</>;
}
