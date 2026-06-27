import Link from 'next/link';

/** Polished 404 for unknown dashboard routes. */
export default function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
      <div className="empty-state">
        <div className="ic">◌</div>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 16 }}>Page not found</div>
        <div className="m" style={{ marginTop: 6 }}>That route doesn’t exist in the control room.</div>
      </div>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" href="/">Back to overview</Link>
        <Link className="btn btn-ghost" href="/tasks">Tasks</Link>
      </div>
    </div>
  );
}
