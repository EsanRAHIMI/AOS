# Jarvis visual baselines

Two independent families live here: the 2D core painter (`gargantua-v*`) and
the WebGL black hole (`gargantua3d-v*`). Each frozen file is a restore point —
never edit a frozen file; fork it forward instead.

## 2D core painter — `../drawGargantua.ts`

| id | file | status |
|----|------|--------|
| `gargantua-v1` | `gargantua-v1.ts` | **Frozen** — warm orbital gold + multi-shell inward glow (locked 2026-07-21) |
| `gargantua-v2` | `gargantua-v2.ts` | **Live / dev** — fork of v1; experiment here |

Live: `../drawGargantua.ts` → `drawGargantuaV2`.

## WebGL black hole — `../gargantua3d.ts`

| id | file | status |
|----|------|--------|
| `gargantua3d-v1` | `gargantua3d-v1.ts` | **Frozen** — first locked raymarch baseline (2026-07-22) |
| `gargantua3d-v2` | `gargantua3d-v2.ts` | **Live / dev** — active on `/jarvis` |
| `gargantua3d-v3` | `gargantua3d-v3.ts` | **Frozen** — byte-exact snapshot of the owner's upgraded look (locked 2026-07-25) |

Live: `../gargantua3d.ts` → `createGargantua3DV2`.

`v3` is a **backup of the current visual**, not a newer experiment: it exists so
the overhauled black hole can always be restored even if `v2` keeps evolving.
All three export the identical `Gargantua3D` module contract, so switching is a
one-line change in `../gargantua3d.ts`.

## Restore

- **WebGL v3 (the upgraded look):** in `../gargantua3d.ts` re-export
  `createGargantua3DV3 as createGargantua3D` and `GARGANTUA_LOCK_V3 as GARGANTUA_LOCK`.
  Cue: «برگردون به gargantua3d-v3».
- **WebGL v1:** same, with `createGargantua3DV1` / `GARGANTUA_LOCK_V1`.
- **2D v1:** re-export `drawGargantuaV1` (+ `luxPaletteFromAccent` from v1 if the
  mesh should match).
- **Partial 2D:** `drawGargantuaV*(..., ['partId'])` or copy from `gargantuaV*Parts`.
- **New lock:** promote the live file into a new frozen `v{n+1}`; never casually
  mutate a frozen file mid-experiment.

Locked 2D v1 includes: stellar outer rings, speak-driven gravity (redder /
orbital spin / thickness breath), multi-shell inward gold glow with soft wide
horizon band. Listening is UI-only (cmdbar/MIC).
