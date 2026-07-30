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

> **Every family of things has its own ORBIT around the singularity, and the
> orbits are ordered by how personal the family is.**

| Orbit | Group | What rides it |
|---|---|---|
| 0 (innermost) | `identity` | the owner's profile, documents, life records |
| 1 | `value` | finance, ventures, assets |
| 2 | `execution` | missions, the living loop, proactive findings |
| 3 | `knowledge` | memory, research |
| 4 | `trust` | the CIN graph, counterparties, relations |
| 5 (outermost) | `infra` | services, infrastructure, the public world |

The self is the singularity itself. Moving outward always means "less mine,
more shared". `scope` survives as a secondary hint: inside its own track a
more personal instance rides slightly to the inside.

**Why orbits instead of a web of edges (D-183.9), and no connectors at all
(D-183.10).** Cards on one orbit are visibly related *because they share a
track* — no line has to say it for them, so **no connectors are drawn,
anywhere**. Two rules carry all of the meaning:

- **a card wears the colour of its orbit**, so which family it belongs to is
  readable at a glance, at any zoom, without following anything;
- **a relationship becomes visible only when it is used.** One piece of data =
  **one small comet** flying from the sending card to the receiving one, with
  a short tail and a bright head, followed by a brief expanding pulse on the
  card where it lands.

Comets fly along the orbital geometry: within a track they ride the arc of the
orbit; between tracks they follow a transfer arc whose radius eases from one
orbit to the other. The board is therefore empty and clean at rest, and every
mark on it means "this actually happened, just now".

### Staying legible at 50–100+ cards

1. **One axis, one meaning** (above) — no ring × wedge grid to decode.
2. **Deterministic slots + lanes.** Cards are spaced evenly around their whole
   track; a crowded orbit adds interleaved lanes rather than letting cards
   overlap. Same input → same seats, every reload.
3. **No connectors** — the only moving marks are comets carrying real data, so
   the board cannot become a hairball no matter how many cards it holds.
4. **Degree of interest.** Clicking a card focuses it: its neighbourhood keeps
   full contrast, the rest of the board recedes, and comets that do not
   involve it are muted. The HUD reports cards, orbits and how many pieces of
   data are in flight right now.

### The singularity sits INSIDE the cage

The neural mesh is painted in **two passes with the black hole between them**
(D-183.11): the half of the cage behind the horizon goes on the main canvas
below the WebGL layer (and is occluded by it), and the half on our side goes on
a transparent `.jarvis-mesh-front-canvas` above it, driven by the same
simulation (`advance:false` on the second pass). The result is that the nodes
visibly rotate *around* a black hole that lives inside the mesh, instead of the
mesh disappearing behind a disc. The singularity's own size and structure are
untouched.

## 3. Architecture (five independent modules + one layer)

```txt
board/
├── boardModel.ts     types, ORBIT table, activity math     (pure data)
├── boardCamera.ts    infinite pan/zoom/orbit + projection (pure math)
├── boardLayout.ts    orbital placement + lanes             (pure function)
├── boardSynapses.ts  orbital routing + packet engine       (renderer-agnostic)
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
`.jarvis-mesh-front-canvas` (z 1) → `.jboard-cards` (z 2) → telemetry (z 3) → caption (z 4) → `.jboard-hud` (z 5)
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

### Bidi readability (D-183.12)

The stage carries Persian and English at the same time, so **direction is a
property of each text node, never of the page**:

- the stage wrapper is explicitly `dir="ltr"` and no longer inherits its
  direction from the caption. Previously a Persian caption made the whole
  stage `rtl`, and every English card title inside it rendered right-aligned
  with flipped punctuation.
- `bidiProps(text)` (in `lib/rtl.ts`) states a direction **both ways** —
  unlike `dirProps`, which omits `dir` for Latin text and is therefore only
  safe inside an LTR container. Card titles, subtitles, empty hints, chips,
  the caption and the telemetry detail all use it.
- metric values, the zoom readout and telemetry keys are `direction: ltr;
  unicode-bidi: isolate` — numbers and units must never re-order.
- free-text nodes also carry `unicode-bidi: plaintext; text-align: start`, so
  even text that arrives without an explicit `dir` resolves its own base
  direction and aligns to the correct edge.
- chrome that is Persian by design (the command bar, the board HUD, the
  layout panel) keeps `dir="rtl"` so its *controls* sit where a Persian
  reader expects them, while the text inside still follows its own script.

## 4. Personalisation

Cards are role-dependent by design. `boardProfile.ts` ships presets for
`founder | operator | engineer | analyst`, each mapping sources to rings (and
hiding what that role does not care about). On top of the preset the owner can:

- switch any card/source off,
- re-assign a source to a different **orbit**,
- **slide a card around its own orbit** (the saved override is a direction,
  never a free position — see below),
- pin cards to stay expanded.

**A card can never leave its orbit by dragging (D-183.11).** Dragging slides it
along its track; the placement override stores an ANGLE only and the layout
re-derives the radius from the card's orbit every frame, so even a profile
saved by an older build snaps back onto a track. Leaving an orbit is a change
of meaning, not of position, so it is only possible through the explicit orbit
selector. Each track also reserves an angular window at 12 o'clock where no
card is ever seated, so the orbit's label stays readable at all times.

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

Synapse traffic is a **readout, not an ornament** (D-183.7 — there is no
free-running spawner anywhere in the renderer):

- **nothing is drawn at rest.** There are no wires to keep permanently lit;
  the orbits and the shared colours already carry the structure.
- **a comet exists only because a real exchange was observed.** Two sources
  feed it: the 12s snapshot diff (a card's metric value, `updatedAt` or
  activity actually changed) and the persistent owner SSE stream, which fires
  the moment the kernel raises a proactive event.
- **count is truthful:** the number of comets equals the number of distinct
  changes observed (`magnitude`), and a live proactive event sends exactly one.
- **direction is truthful:** comets leave the card whose records changed and
  fly to the cards it feeds.
- **arrival is visible:** landing a comet triggers a 0.9s expanding pulse on
  the destination card (`SynapseTraffic.arrivalOf`), so the owner sees *where*
  data went, not just that something moved.
- the HUD prints the age of the last real exchange, so a still board reads as
  "nothing moved", never as "the animation is broken".

`prefers-reduced-motion` slows the packet simulation instead of faking calm.

The six legacy concept threads that used to radiate from the singularity
(MEMORY / LIVING LOOP / HEARTBEAT / TRUST CHAIN / MISSIONS / RESEARCH) were
removed in D-183.7: the board now carries real, data-backed cards for exactly
those domains, wired by real synapses, so decorative stand-ins beside them
would be noise.

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
| click a card | focus it — neighbourhood stays lit, the rest recedes; click again or click empty space to release |
| drag a card | hand-place it permanently |
| double-click a card | focus + fly the camera to it |
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
