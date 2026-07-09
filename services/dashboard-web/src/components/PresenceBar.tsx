'use client';
import { summonJarvis } from './UniverseZone';
import type { JarvisBriefingView } from '@/app/jarvis/actions';

/**
 * Phase AF.1 Step 2 — The Jarvis Presence Bar.
 *
 * Replaces the old "Jarvis today-summary card" (one flattened sentence).
 * Renders the REAL, structured `/v1/jarvis/briefing` response (Phase AE,
 * corrected in AE.1) — the single most concrete "built but never shown"
 * gap identified in docs/living-command-universe-vision.md §A.8. No
 * hardcoded values: every field below is read straight from the briefing
 * prop; an honest empty/unreachable state renders when it is null.
 */

function relativeFreshness(iso: string): string {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function confidenceLabel(c: number): { label: string; tone: 'ok' | 'warn' | 'err' } {
  if (c >= 0.75) return { label: `${Math.round(c * 100)}% confidence`, tone: 'ok' };
  if (c >= 0.45) return { label: `${Math.round(c * 100)}% confidence`, tone: 'warn' };
  return { label: `${Math.round(c * 100)}% confidence`, tone: 'err' };
}

export function PresenceBar({ briefing, memoryInsights }: { briefing: JarvisBriefingView | null; memoryInsights?: string[] }) {
  if (!briefing) {
    return (
      <div className="card" style={{ marginBottom: 14, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-2)' }} />
          <b style={{ fontSize: 13 }}>Jarvis</b>
        </div>
        <div className="m" style={{ fontSize: 12.5 }}>
          The daily briefing is not reachable right now — nothing is fabricated in its place. Try again shortly, or ask Jarvis directly below.
        </div>
      </div>
    );
  }

  const conf = confidenceLabel(briefing.confidence);
  const hasPriority = Boolean(briefing.primaryPriority);

  return (
    <div className="card" style={{ marginBottom: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="op-active-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
          <span className="label">Jarvis · daily command briefing</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${conf.tone}`}>{conf.label}</span>
          <span className="m" style={{ fontSize: 11 }} title={briefing.dataFreshness}>as of {relativeFreshness(briefing.dataFreshness)}</span>
        </div>
      </div>

      {/* Primary priority — the whole point of this bar. Never flattened
          into prose: this is what the owner explicitly said matters, or an
          honest statement that nothing is ranked yet. */}
      <div style={{ fontSize: hasPriority ? 17 : 13, fontWeight: hasPriority ? 750 : 500, lineHeight: 1.35 }}>
        {hasPriority ? briefing.primaryPriority : 'No ranked priority yet — tell Jarvis what matters most, or build your baseline.'}
      </div>

      {briefing.activeBlockers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label" style={{ fontSize: 10 }}>Active blockers — do not replace the priority above, just need attention alongside it</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {briefing.activeBlockers.slice(0, 4).map((b, i) => (
              <span key={i} className="badge err" style={{ fontSize: 11 }}>{b.slice(0, 90)}</span>
            ))}
          </div>
        </div>
      )}

      {briefing.systemWarnings.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {briefing.systemWarnings.slice(0, 3).map((w, i) => (
            <span key={i} className="chip" style={{ fontSize: 10.5, opacity: 0.75 }} title="System warning — informational, not your priority">{w.slice(0, 70)}</span>
          ))}
        </div>
      )}

      {briefing.recommendedNextActions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label" style={{ fontSize: 10 }}>Jarvis recommends</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {briefing.recommendedNextActions.slice(0, 4).map((a, i) => (
              <button key={i} type="button" className="chip" style={{ cursor: 'pointer', fontSize: 11.5 }} onClick={() => summonJarvis(a)}>◈ {a}</button>
            ))}
          </div>
        </div>
      )}

      {briefing.narrative && (
        <div className="m" style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.85 }}>{briefing.narrative}</div>
      )}

      {briefing.memoryFactsUsed.length > 0 && (
        <div className="m" style={{ fontSize: 10 }}>
          Grounded in {briefing.memoryFactsUsed.length} remembered fact{briefing.memoryFactsUsed.length === 1 ? '' : 's'} — {briefing.memoryFactsUsed.slice(0, 3).map((f) => f.kind).join(', ')}.
        </div>
      )}

      {/* Kernel-level operator memory (decisions, mistake-avoidance, workflow
          notes) — distinct from the extracted Jarvis facts above. Real field
          on /v1/me/universe that had zero consumers before this phase. */}
      {memoryInsights && memoryInsights.length > 0 && (
        <div className="m" style={{ fontSize: 10, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          Recent memory: {memoryInsights[0].slice(0, 140)}
        </div>
      )}
    </div>
  );
}
