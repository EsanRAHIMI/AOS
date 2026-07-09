/**
 * Phase AF.2 Step 4 — domain-specific Jarvis annotations.
 *
 * Replaces the one-size-fits-all `JarvisAnnotation` that used to just
 * restate `zone.jarvisCommand` for every zone. This produces a distinct,
 * zone-aware message: why the domain matters, what's concretely missing or
 * wrong, and what to do about it — always built from the zone's own real
 * `metrics`/`status`/`headline` fields, never invented copy independent of
 * data. Pure function, no React, so it's directly unit-testable.
 *
 * Also replaces the old dashed `setupHint` box: this is now the single
 * place a card explains itself, instead of two separate boxes saying
 * overlapping things.
 */

export interface InsightZone {
  zoneId: string;
  status: string;
  headline: string;
  setupHint: string;
  jarvisCommand: string;
  metrics: Array<{ label: string; value: string; tone: string }>;
}

export interface DomainInsight {
  /** One of the four categories the product spec asks Jarvis to
   *  distinguish. Drives which border/icon treatment the card uses. */
  kind: 'setup_needed' | 'not_configured' | 'blocker' | 'opportunity';
  text: string;
}

function metric(zone: InsightZone, label: string): string {
  return zone.metrics.find((m) => m.label === label)?.value ?? '0';
}

/** Returns null for a 'live' zone with nothing to flag — silence is the
 *  correct answer when there is genuinely nothing to say. */
export function buildDomainInsight(zone: InsightZone): DomainInsight | null {
  if (zone.status === 'live') return null;

  switch (zone.zoneId) {
    case 'health': {
      if (zone.status === 'attention') {
        const concerns = metric(zone, 'concerns');
        return { kind: 'blocker', text: `${concerns} flagged health concern(s) — small issues left untracked tend to compound. Ask Jarvis: "${zone.jarvisCommand}"` };
      }
      return { kind: 'setup_needed', text: `Jarvis can't watch what it isn't told. ${zone.setupHint}` };
    }
    case 'daily':
      return { kind: 'setup_needed', text: `Nothing ranked yet — priorities here are derived from your goals, risks and opportunities, never guessed. ${zone.setupHint}` };
    case 'life': {
      if (zone.status === 'attention') {
        const high = metric(zone, 'high');
        return { kind: 'blocker', text: `${high} high-importance item(s) in your personal world are waiting on you. Ask Jarvis: "${zone.jarvisCommand}"` };
      }
      return { kind: 'setup_needed', text: `Family, home and household responsibilities aren't mapped yet, so Jarvis can't flag what's slipping. ${zone.setupHint}` };
    }
    case 'finance': {
      if (zone.status === 'attention') {
        return { kind: 'blocker', text: `Outflow is currently exceeding inflow — net cashflow is negative. Worth reviewing obligations before they compound. Ask Jarvis: "${zone.jarvisCommand}"` };
      }
      return { kind: 'setup_needed', text: `No financial structure recorded — Jarvis will never invent an amount you didn't give it. ${zone.setupHint}` };
    }
    case 'ventures':
      return { kind: 'setup_needed', text: `No ventures tracked yet, so there's nothing to rank by income potential or link to a goal. ${zone.setupHint}` };
    case 'growth': {
      const goals = metric(zone, 'goals');
      if (Number(goals) > 0) {
        return { kind: 'opportunity', text: `You have goals but no learning track pointed at them yet — that's a gap worth closing. Ask Jarvis: "${zone.jarvisCommand}"` };
      }
      return { kind: 'setup_needed', text: `No growth direction recorded yet. ${zone.setupHint}` };
    }
    case 'opportunities':
      return { kind: 'setup_needed', text: `No upside recorded — real market research arrives with a research provider; nothing here is invented in the meantime. ${zone.setupHint}` };
    case 'systems': {
      const incidents = metric(zone, 'incidents');
      return { kind: 'blocker', text: `${incidents} open incident(s) affecting infrastructure — a technical blocker, not a change to your stated priority. Ask Jarvis: "${zone.jarvisCommand}"` };
    }
    case 'presence':
      return { kind: 'not_configured', text: `No channels connected — presence intelligence stays honestly silent until you grant a read-only consent. ${zone.setupHint}` };
    default:
      return { kind: 'setup_needed', text: zone.setupHint };
  }
}
