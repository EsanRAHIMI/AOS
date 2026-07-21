# Jarvis visual baselines

| id | file | status |
|----|------|--------|
| `gargantua-v1` | `gargantua-v1.ts` | **Frozen** — warm orbital gold + multi-shell inward glow (locked 2026-07-21) |
| `gargantua-v2` | `gargantua-v2.ts` | **Dev** — fork of current v1; experiment here |

Live: `../drawGargantua.ts` → `drawGargantuaV2`.

## Restore

- Full v1: re-export `drawGargantuaV1` (+ `luxPaletteFromAccent` from v1 if mesh should match)
- Full v2: re-export `drawGargantuaV2`
- Partial: `drawGargantuaV*(..., ['partId'])` or copy from `gargantuaV*Parts`
- New lock: promote v2 into v1 (or add `v3`); never casually mutate a frozen file mid-experiment

Locked v1 includes: stellar outer rings, speak-driven gravity (redder / orbital spin / thickness breath), multi-shell inward gold glow with soft wide horizon band. Listening is UI-only (cmdbar/MIC).
