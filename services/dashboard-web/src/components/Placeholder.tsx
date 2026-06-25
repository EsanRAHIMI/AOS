export function Placeholder({ title, sub, phase, note }: { title: string; sub: string; phase: string; note: string }) {
  return (
    <>
      <h1 className="h1">{title}</h1>
      <p className="sub">{sub}</p>
      <div className="card">
        <span className="badge warn">{phase}</span>
        <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>{note}</p>
      </div>
    </>
  );
}
