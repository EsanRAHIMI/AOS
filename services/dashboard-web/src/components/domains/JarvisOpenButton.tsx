'use client';
import { summonJarvis } from '../UniverseZone';

/** Phase AF.5 — the one client-side control a dedicated domain room's
 *  server-rendered header needs: opening Jarvis with a contextual command.
 *  Isolated to its own tiny client component so `DomainRoom` itself stays a
 *  server component. */
export function JarvisOpenButton({ command }: { command: string }) {
  return (
    <button type="button" className="btn btn-ghost" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => summonJarvis(command)} title={`Ask Jarvis: “${command}”`}>
      ◈ Ask Jarvis
    </button>
  );
}
