'use client';

/** Living Loop client controls (CIN-2b, D-181): live auto-refresh, manual
 *  tick, and approval decisions — thin calls to the loop API proxies. */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function TickButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await fetch('/api/loop-tick', { method: 'POST' }); router.refresh(); } finally { setBusy(false); }
    }}>{busy ? 'ticking…' : 'Run tick now'}</button>
  );
}

export function DecisionButtons({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await fetch('/api/loop-decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cycleId, action }) });
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button className="btn" disabled={busy} onClick={() => decide('approve')}>approve</button>
      <button className="btn" disabled={busy} onClick={() => decide('reject')}>reject</button>
    </span>
  );
}
