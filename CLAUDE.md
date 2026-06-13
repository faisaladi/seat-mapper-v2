# Seat Mapper v2 — Agent Guide

Context for AI agents working in this repo. Read this first.

---

## What this is

A browser-based **seat-map authoring & editing tool** for **TipTip** (a ticketing
platform). It opens, edits, and exports the seating-plan JSON that TipTip renders
and books against. TipTip's JSON format is the same shape as **seats.pretix.eu**
exports, so this tool doubles as a pretix-plan editor.

**Goal:** let the owner (Faisal, a PM at TipTip) author and edit seating plans
*without* needing seats.pretix.eu. It already exceeds pretix in places — bezier
curve drawing/editing, snapping, multi-select group move, copy/paste.

It is a **single-user, client-side** tool: no backend, no auth. A plan is loaded
from a JSON file (or created blank), edited in-browser, and exported as JSON. A
debounced copy is autosaved to `localStorage` so a refresh doesn't lose work.

**Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4,
`lucide-react` icons. Rendering is a hand-rolled HTML `<canvas>` engine (no
canvas library). GitHub: `faisaladi/seat-mapper-v2`.

---

## Run / verify / ship

```bash
npm run dev        # dev server on :3000
npx tsc --noEmit   # type-check — THE gate; run after every change, keep it clean
npm run build      # production build
```

- **Always `npx tsc --noEmit` after edits.** `next lint` is flaky on this setup
  (a config issue), so tsc is the real compile gate.
- **Verify in the browser, not just by reading code.** Use the `preview_*` tools
  (preview_start name `seat-mapper`, preview_eval, preview_screenshot). The
  canvas is the product — screenshot to confirm visual changes. Drive flows with
  preview_eval dispatching mouse/keyboard events.
- **Testing-in-browser gotchas (important):**
  - Synthetic events dispatched *synchronously* in one `preview_eval` don't let
    React re-render between them, so state read in the next handler is stale.
    Put `setTimeout` gaps between mousedown→move→up, or rely on the **ref-backed**
    gesture state (see below).
  - Panel `<input>`s are uncontrolled (`defaultValue` + `key`); setting `.value`
    then calling `.blur()` may not fire React's `onBlur`. Dispatch a
    `FocusEvent('focusout', {bubbles:true})` (React listens via focusout), or use
    the `preview_fill` tool.
  - **`localStorage` autosave is debounced 800ms** — wait ~1.2s before reading it
    back to confirm a mutation persisted.
  - The preview console buffer accumulates across reloads; you'll see repeated
    dev-only *"useEffect dependency array changed size between renders"* warnings
    — these are **Fast Refresh artifacts** from editing hook deps mid-session, not
    real bugs (zero on a fresh production load). Ignore them.

### Git
- Work on `main` (it's a solo tool). Commit when a feature/fix is verified.
- Co-author trailer used in this repo:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Commit messages: imperative subject, then a body explaining the *why* and what
  was verified. See `git log` for the established style.

---

## Architecture

`src/app/seat-map-editor.tsx` is the orchestrator (~2.4k lines: React state, the
mouse/keyboard handlers, the `draw()` frame composer, and all the mutation
callbacks). Everything reusable was extracted into three folders:

```
src/app/
  seat-map-editor.tsx     ← main component: state, handlers, draw(), callbacks
  model/                  ← pure data, NO React
    types.ts              ← SeatData/Zone/Row/Seat/Area/Category/Polygon… types
    ops.ts                ← pure mutations + factories (numbering, curve, insert,
                            delete, offset, area factories, arrange, duplicate…)
    metrics.ts            ← computeContentMetrics: abs seat positions, content
                            bbox, and the JSON canvas rect; drives fit/clamp
  engine/                 ← canvas systems (mostly framework-light)
    render.ts             ← paintScene(): areas + seats + row labels (world coords)
    hit-test.ts           ← findObjectAtPosition() + isPointInPolygon()
    transform.ts          ← resize-handle geometry (oriented box, handles, resize)
    pen.ts                ← bezier path math: tessellate / tracePath / bbox
    snap.ts               ← snapPoint/snapAxis (peer + grid snapping) + GRID_SIZE
    useViewport.ts        ← zoom/pan/fit/HiDPI/wheel + rAF redraw loop (hook)
    useHistory.ts         ← snapshot undo/redo behind beginGesture() (hook)
  panels/                 ← React UI
    toolbar.tsx           ← top toolbar (modes, tools, undo/redo, file actions)
    properties-panel.tsx  ← right contextual panel (plan/seat/row/shape/selection)
    numbering-wizard.tsx  ← bulk numbering & labeling modal
    new-plan-modal.tsx, insert-modal.tsx
```

When adding logic, prefer the right home: pure data → `model/`, canvas math →
`engine/`, UI → `panels/`. Keep `seat-map-editor.tsx` as glue.

`docs/pretix-parity-plan.md` is the **living roadmap** — feature status (✅/🟡),
ICE scores, and what's next. Update it when you ship something.
(`docs/seat_rendering.md` is older and partly stale — render now lives in
`engine/render.ts`, not a `drawSeatMap` function.)

---

## The data model & TipTip rules (critical — don't break these)

The plan is one `SeatData`: `{ name, size:{width,height}, categories[], zones[] }`.
TipTip uses a **single zone**; seats live in `zone.rows[].seats[]`, shapes in
`zone.areas[]`. Positions are relative: seat → row → zone (`seatWorld =
seat.pos + row.pos + zone.pos`); area → zone.

Hard rules (these key real bookings / break TipTip import if violated):
- **Never regenerate `seat_guid` / `uuid` on existing seats** — TipTip keys
  bookings on them. Only mint fresh ids for *brand-new* seats (insert, paste,
  duplicate).
- **`seat_number` = the full rendered label** (e.g. `"A18"`), not a bare number.
  The numbering wizard bakes `{row}{n}` into `seat_number` (TipTip mode).
- **Category `name` = the ticket UUID** of the target show; it's swapped per show.
  We keep a human alias in **`categories[].label`** (an extra field TipTip's
  importer tolerates) so the readable name survives the UUID swap. Category↔seat
  link is by `name`, so **duplicate category names are blocked** (ambiguous).
- **Canvas = `size` rect.** TipTip renders against `{width,height}`, so the editor
  draws the white card at `(0,0,width,height)` and places everything at true
  coordinates. The viewport `bounds` = canvas ∪ content (so off-canvas content
  stays reachable).
- **Curved polygons:** `polygon.points` is a dense **tessellated** point list
  (pretix/TipTip only understand straight points) baked from `polygon.nodes` —
  our extra field holding the editable bezier anchors+handles, so curves survive
  re-open. Keep both in sync when editing (`tessellate(nodes,true)`).
- Extra fields on parsed JSON survive untouched — we only mutate known fields.

---

## Conventions & gotchas you must know

- **Undo = snapshots.** Call `beginGesture()` **once** before any mutation (or at
  the start of a drag). One user action = one undo step. `useHistory` keeps a
  50-deep `structuredClone` stack; `canUndo/canRedo` drive the toolbar.
- **Mutations: deep-clone, set, re-select.** The pattern that works everywhere:
  `beginGesture(); const next = structuredClone(seatData); ...mutate next...;
  setSeatData(next); setSelectedObject({...sel, data: <fresh object from next>})`.
  **Do not** re-find the selected object by hit-testing after a mutation — that
  was a real bug (rotating a rect moved it out from under its old anchor, so the
  hit-test missed and the panel desynced from `seatData`). Re-select **by index**.
- **Active gestures use refs, not state**, so the synchronous mousedown→move→up
  path reads fresh values without waiting for a re-render: `resizeRef`,
  `groupDragRef`, `polyEditRef`, `shapeDraftRef`, `penNodesRef`, `panLastRef`,
  plus mirror refs `selectedObjectRef`/`selectedSeatsRef`/`seatDataRef` (assigned
  every render). Reach for a ref when a handler must see the latest value mid-gesture.
- **Selection is split:** `selectedObject` (a single seat/area/row, drives the
  contextual panel) **and** `selectedSeats: Set<guid>` (the multi-seat marquee
  selection, drives the bulk status/category/bend/delete panel). They're mutually
  exclusive in practice — setting one usually clears the other.
- **Hit-testing must cover every shape.** `findObjectAtPosition` handles seat,
  rectangle (rotation-aware), circle, ellipse, polygon, **and text**. If you add a
  shape kind, add its hit-test AND its selection-highlight in `draw()` AND (if
  resizable) its `areaToBox` case — these three must stay in lockstep, or the
  shape will look selectable but won't be (that was the text bug).
- **Rotation:** rectangles rotate around their center (render, hit-test,
  resize-box, highlight all rotation-aware). Circle rotation is meaningless.
- **Coordinate transforms:** `screenToWorld` (from `useViewport`) for input;
  `world*scale + offset` for output. Overlay stroke widths are divided by
  `view.scale` so they stay constant on screen. The static layer is a cached
  bitmap sized to `bounds`; past a zoom threshold `draw()` switches to direct
  culled vector painting so seats stay crisp.
- **Canvas wheel listener is native + non-passive** (`{passive:false}`) — React's
  synthetic `onWheel` is passive and can't `preventDefault()` the browser's page
  zoom. Don't move wheel handling back to JSX.
- App is **light-mode only** (`color-scheme: light` in globals.css) — don't
  reintroduce dark-mode styles; they made text invisible before.

---

## Feature status (what already works)

Authoring loop is complete: **New Plan** (name + initial grid) or Upload JSON →
**Insert** seat blocks → **Numbering wizard** (bulk row/seat labels, `{row}{n}`)
→ draw shapes → **Export** (direct download).

- **Viewport:** cursor-anchored zoom, pan, fit-to-content, HiDPI, grid toggle.
- **Select/transform:** marquee select, shift-click multi-select, shift-drag
  extend, group move (Move tool), keyboard nudge, delete, resize handles
  (rect/circle/ellipse, rotation-aware), snapping to peers+grid with guides.
- **Shapes:** rectangle, ellipse, text (click-place), and a **pen tool** for
  polygons + bezier curves (click=corner, drag=curve, Enter/dbl-click/click-first
  to close). **On-canvas curve re-editing** — drag a selected polygon's anchors
  (snap) and handles. **Arrange** z-order (seats always paint in front).
- **Categories:** alias + UUID edit (UUID-format validated), color, add/delete,
  click count to select all of a category's seats.
- **Edit:** undo/redo (⌘Z/⇧⌘Z), copy/paste/duplicate (⌘C/⌘V/⌘D + buttons),
  autosave + "Restore last session", drag-and-drop JSON to open, toasts.
- **Rotation** works for all rotatable shapes; **canvas size** editable.

**Open ideas / next candidates** (see `docs/pretix-parity-plan.md` for detail):
validation panel (flag dup guids/labels, no-category seats, overlaps before
export), background-image tracing, find-seat + status-paint, on-canvas rotate
handle, add/remove polygon anchors, AI plan generation, TipTip Content Hub embed.

---

## Owner & working style

Faisal is the PM/owner; he uses this as a real tool, not a demo. He reports bugs
by describing the user-facing symptom ("I can't move a pasted group", "rotation
didn't work") — reproduce the symptom, find the root cause, fix it, and **verify
in the browser with a screenshot** before claiming it's done. Keep changes
scoped, type-check clean, and update the roadmap doc.
