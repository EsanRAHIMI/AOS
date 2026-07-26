# CIN-2c — The Jarvis Infinite Board

**Route:** `/jarvis` · **Code:** `services/dashboard-web/src/app/jarvis/board/`
**Status:** implemented (D-183). Extends the presence stage; does not replace it.

---

## 1. What it is

`/jarvis` is an **infinite 3D board** — Figma-style unbounded pan/zoom, but in
three dimensions — with the **Gargantua singularity at world origin**. Every
live part of the system sits on it as a card, and cards that genuinely exchange
data are wired together like neurons, with packets visibly travelling along the
axons in real time.

## 2. The orbital law (the one rule that gives the board meaning)

> Distance from the centre encodes **how personal the subject is.**

| Ring | Scope | What lives there |
|---|---|---|
| 0 | `self` | the owner — the singularity itself |
| 1 | `personal` | profile, finance, documents & life records |
| 2 | `work` | projects/ventures, missions, proactive findings |
| 3 | `org` | living loop, memory, CIN identity graph |
| 4 | `network` | counterparties, relations, services/infrastructure |
| 5 | `world` | research and the public/macro layer |

Moving outward always means "less mine, more shared". A card's ring is
therefore semantic — it is never decoration, and the owner can re-assign it
(see §4) because only the owner knows what is personal to them.

## 3. Architecture (five independent modules + one layer)

```txt
board/
├── boardModel.ts     types, scope rings, activity math   (pure data)
├── boardCamera.ts    infinite pan/zoom/orbit + projection (pure math)
├── boardLayout.ts    ring placement, overlap relaxation   (pure function)
├── boardSynapses.ts  axon curves + packet simulation      (renderer-agnostic)
├── boardProfile.ts   role presets + owner overrides       (persistence seam)
├── boardSources.ts   'use server' — real gateway → graph  (fail-soft)
└── JarvisBoard.tsx   the only file that touches the DOM
```

Nothing imports the black hole and the black hole imports nothing here. The
board reports its projected origin through `onOriginChange` (with
`scale = perspective × zoom-vs-default`, so the black hole shrinks when you
zoom out to see the whole space and never swallows the inner rings); `JarvisCoreHUD`
feeds that into `resolveJarvisEnsemble({ boardOrigin })`, so the singularity,
the neural cage and the concept threads all travel and scale with the board as
one organism. Omit `boardOrigin` and the stage renders exactly as it did
before the board existed — that is the rollback path.

**One world, one scale.** Ring radii, card size and the singularity's radius
all multiply by the same `cam.zoomScale` (= `2^(zoom − DEFAULT_ZOOM)`, so it is
exactly 1 at the opening view). Cards are objects *on* the board, not chrome —
if only the black hole scaled, zooming would just spread fixed-size cards apart
while the horizon grew, which is the bug fixed in D-183.4. Two deliberate
exceptions: card **opacity** follows perspective only (a depth cue must not
fade the board out when you zoom out), and card content switches to a
level-of-detail chip below ~0.5 scale so a far view stays readable.

**Layer order (fragile — read before editing CSS):** the stage paints
`.jarvis-live-canvas` → `.jboard-canvas` (z 1) → `.jarvis-gl-canvas` (z 1) →
`.jboard-cards` (z 2) → telemetry (z 3) → caption (z 4) → `.jboard-hud` (z 5)
→ `.jboard-panel` (z 6). The `.jboard` wrapper **must keep `z-index: auto` and
full opacity**: giving it a numeric z-index (or any opacity < 1, filter, or
transform) creates a stacking context that traps the cards and the zoom HUD
*below* the Gargantua canvas — they vanish behind the black hole. Dimming is
therefore applied to `.jboard-canvas`/`.jboard-cards`, never the wrapper.

`.jboard-canvas`'s own `z-index: 1` is equally load-bearing (D-183.6):
`.jarvis-live-canvas` hard-clears with an **opaque** `#070a12` fill every
frame, so a board canvas left at the default layer is repainted over — every
ring and every synapse disappears while the DOM cards (z 2) keep rendering,
which reads as "the cards have no connections at all". At z 1 the board canvas
draws above that clear but still below the Gargantua canvas (also z 1, later
in DOM), so the singularity keeps occluding axons that pass behind it.

**Wheel and pinch are captured at the STAGE, not the board (D-183.5).** The GL
canvas is a *sibling* of `.jboard` and carries its own `wheel` handler that
moves the black hole's private camera distance. A wheel over the centre
therefore never reached the board — only the singularity resized, which is
exactly the "black hole scales on its own" bug. The board now registers
`wheel` + `pointerdown/move/up` listeners on the stage element in the
**capture phase** (`{ capture: true, passive: false }`) and calls
`preventDefault()` + `stopPropagation()`, so zoom always drives the world and
the singularity only ever changes size as part of it. Single-pointer gestures
are deliberately left alone, which is why drag-to-orbit the black hole still
works.

**Pointer arbitration (why the black hole still drags):** the GL canvas keeps
its own `pointerdown/wheel/dblclick` handlers, but each frame the stage sets
`clip-path: circle(R at cx cy)` on it. The disc is far wider than the drawn
horizon (`bhKeepout × 1.35`), so nothing visible is cut — it only limits the
canvas's *hit area*. Inside the disc: drag orbits Gargantua exactly as before.
Outside: events reach the board and pan the world.

## 4. Personalisation

Cards are role-dependent by design. `boardProfile.ts` ships presets for
`founder | operator | engineer | analyst`, each mapping sources to rings (and
hiding what that role does not care about). On top of the preset the owner can:

- switch any card/source off,
- re-assign a source to a different ring,
- drag a card anywhere (hand-placed cards never move again),
- pin cards to stay expanded.

Overrides always beat presets. Persistence is `localStorage`
(`aos.jarvis.board.profile.v1`) today; `loadBoardProfile`/`saveBoardProfile`
are the seam for moving it to `PATCH /v1/me/profile` server-side later without
touching any other file.

## 5. Live data and honest synapses

`loadBoardGraphAction` (server action) assembles the graph from real endpoints
only: loop cycles/inbox, `me/universe/detail` (finance, life, ventures, growth,
opportunities, systems), CIN entities + chain verification, memories, research,
services, `me/context`. Every source is independent and fail-soft — an
unreachable endpoint adds its name to `degraded` and contributes **no card**
rather than a fabricated one. Cards with nothing yet render an explicit
`emptyHint`.

Synapse traffic is a **readout, not an ornament**:

- `link.strength` (structural) sets the resting axon thickness — the wiring is
  always visible, so the network reads as a network even at rest,
- effective traffic is `max(link.flow, sending card activity × 0.5)`: both are
  real signals, so an active card visibly pushes packets down its axons even
  on edges that have no counter of their own,
- packets carry a short comet tail (drawn additively) so the direction of the
  exchange is unmistakable,
- a card whose activity jumps between polls fires an immediate burst.

A quiet system therefore looks quiet. `prefers-reduced-motion` slows the
simulation instead of faking calm.

## 6. Controls

| Action | Result |
|---|---|
| drag empty space | pan (infinite) |
| wheel | zoom about the cursor (`WHEEL_GAIN`, delta-mode normalised) |
| trackpad pinch | zoom about the cursor — arrives as ctrl+wheel, handled with a **non-passive native listener** so it never triggers browser zoom (`TRACKPAD_GAIN`) |
| two-finger pinch (touch) | zoom about the pinch midpoint (`PINCH_GAIN`, faster than 1:1 finger distance) |
| `+` / `−` buttons, `+` / `−` keys | zoom about the viewport centre |
| zoom slider | direct zoom, with a live % readout |
| **«کل فضا» button / `F` key** | **fit everything on screen** — centres on the content's centroid and picks the zoom that contains the farthest card (works no matter how far cards were dragged out) |
| «مرکز» button / `0` key | return to the singularity at default zoom |
| Alt+drag or right-drag | orbit the board (yaw/pitch) |
| drag a card | hand-place it permanently |
| double-click a card | focus + reveal its actions |
| drag over the black hole | orbit Gargantua (unchanged) |
| «چیدمان» button | personalisation panel |

**Controls inside the board never start a board gesture.** `onPointerDown`
returns early for `button, a, select, input, textarea, label, .jboard-hud,
.jboard-panel`. This is not cosmetic: Chrome delivers `click` to the pointer
CAPTURE target, so capturing on the wrapper silently swallows every click on
the zoom HUD, the layout panel and the card actions. Any new control added to
the board must sit inside one of those selectors (or add its own).

Zoom range is `2^-3.2 … 2^3.4` (≈ 11 % … 1055 %), so the whole `world` shell
fits comfortably at the low end and a single card fills the screen at the high
end. Keyboard shortcuts are ignored while the command bar has focus.

## 7. Visual baselines are untouched

The board added zero changes to `gargantua3d-v2.ts` (live) or any frozen
baseline. The owner's upgraded black hole is additionally frozen as
`baselines/gargantua3d-v3.ts` — a byte-exact restore point; see
`baselines/README.md`.
