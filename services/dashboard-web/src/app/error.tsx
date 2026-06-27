'use client';
import { useEffect } from 'react';

/** Route-level error boundary — every page gets a clear, actionable error card. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="card error-card" role="alert" style={{ maxWidth: 560, margin: '40px auto' }}>
      <div className="empty-state">
        <div className="ic" style={{ color: 'var(--err)' }}>⚠</div>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 16 }}>Something went wrong loading this page</div>
        <div className="m" style={{ marginTop: 6 }}>
          This is usually a transient gateway or network issue. The kernel itself is unaffected.
        </div>
      </div>
      <div className="m" style={{ fontSize: 12, background: 'var(--glass-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px', margin: '4px 0 14px', wordBreak: 'break-word' }}>
        {error.message || 'Unknown error'}{error.digest ? ` · ref ${error.digest}` : ''}
      </div>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
        <a className="btn btn-ghost" href="/">Back to overview</a>
      </div>
      <p className="m" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 12, marginBottom: 0 }}>
        If it persists, check that the gateway API is reachable and the internal token is set.
      </p>
    </div>
  );
}
