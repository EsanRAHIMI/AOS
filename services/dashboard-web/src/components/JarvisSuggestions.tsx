'use client';
import { summonJarvis } from './UniverseZone';

/**
 * Phase AD — clickable Jarvis-suggested prompts on the Command Universe home.
 * Real suggestions only: the gateway derives these from actual zone status
 * (attention first, then setup-ready, then live) — never decorative copy.
 * Clicking one opens the Operator Console and runs it through the same
 * gated Jarvis pipeline as typing it manually.
 */
export function JarvisSuggestions({ prompts }: { prompts: string[] }) {
  if (prompts.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {prompts.map((p, i) => (
        <button key={i} type="button" className="chip" style={{ cursor: 'pointer', fontSize: 11.5 }} onClick={() => summonJarvis(p)}>
          ◈ {p}
        </button>
      ))}
    </div>
  );
}
