/** Route-level loading skeleton — shown for every page while its server data loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="page-header">
        <div className="skeleton" style={{ width: 220, height: 26, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: '60%', maxWidth: 460, height: 13 }} />
      </div>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="card metric" key={i}>
            <div className="skeleton" style={{ width: 90, height: 11 }} />
            <div className="skeleton" style={{ width: 60, height: 28, marginTop: 4 }} />
          </div>
        ))}
      </div>
      <div className="card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="skeleton" key={i} style={{ height: 16, margin: '12px 0', width: `${92 - i * 9}%` }} />
        ))}
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading…</span>
    </div>
  );
}
