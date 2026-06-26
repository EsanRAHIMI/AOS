export const dynamic = 'force-dynamic';
export default function PolicyProfilesPage() {
  return (
    <>
      <h1 className="h1">Policy Profiles</h1>
      <p className="sub">Versioned bundles of active policy rules. Hardcoded safety blocks always apply on top.</p>
      <div className="card"><div className="empty">No policy profile versions yet — code defaults + any approved rules are in effect.</div></div>
    </>
  );
}
