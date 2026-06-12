> ⚠️ AI DRAFT — PM REVIEW REQUIRED

# Seat Mapper v2 — UX Improvements & seats.pretix.eu Parity Plan

**Owner:** Faisal (PM) · **Drafted:** June 2026
**Goal:** evolve the tool from a bulk status editor into a full seat-plan *authoring* tool, so plans can be created and labeled for TipTip without seats.pretix.eu and without renaming rows one by one.

---

## 1. Context

- Today the tool renders pretix/TipTip seating JSONs and bulk-edits seat **status** (and category).
- Plans are authored in seats.pretix.eu, exported, then **manually relabeled**: pretix stores row identity as `row_number` ("AA") + bare `seat_number` ("18") + `seat_label` template ("AA%s"), but TipTip renders **only the seat label**, so every seat must be renamed to a fully-qualified label by hand. The most common organizer convention is `{row}{n}` (seat_label `A%s` → "A18"); some events use separators or section prefixes (`Q3-97`). In pretix the `seat_label` template must be set **row by row** — that is the time sink to eliminate.
- **Second confirmed time sink — category ↔ ticket mapping:** TipTip requires each category `name` to be the **ticket UUID of the target event/show**. For multi-show runs the same physical plan must be re-uploaded once per show, each time hand-pasting that show's ticket UUIDs from Retool into the category names. (See N9 below.)
- Zones: pretix-style multi-zone is **not used** in TipTip — single big map; "zone" is encoded into the seat label when needed. The editor can stay single-zone-first.
- `seat_guid`/`uuid` are the TipTip seat identifiers — the wizard must never rewrite them, and no readable-guid regeneration feature is needed.
- Reference plan analyzed: *Opus Deccenium 1* (1,144 seats, 97 rows, 23 areas: 4 rect / 7 ellipse / 7 polygon / 5 text, curved rows, `row_number_position` start/end/both). Findings:
  - Curved rows are plain per-seat `position` offsets along an arc — generatable with math, no special schema.
  - `seat_guid` is human-readable (`Groundfloor-G-9`) and **21 duplicate guids exist in the source plan** (the tool currently auto-renames them silently on upload).
  - 17 seats carry a custom `radius`; pretix file has no `status` field (TipTip adds it).

### Schema cheat-sheet (fields the editor must read/write)

| Level | Fields |
|---|---|
| Plan | `name`, `size {width,height}`, `categories[{name,color}]`, `zones[]` |
| Zone | `name`, `uuid`, `zone_id`, `position`, `rows[]`, `areas[]` |
| Row | `uuid`, `position`, `row_number`, `row_number_position` (start/end/both), `seat_label` ("AA%s"), `seats[]` |
| Seat | `uuid`, `seat_guid`, `seat_number`, `position`, `category`, `radius?`, `status?` (TipTip) |
| Area | `uuid`, `shape` (rectangle/circle/ellipse/polygon/text), `position`, `color`, `border_color`, `rotation`, shape payload, `text {text,color,size,position?}` |

**Rule: never regenerate `seat_guid` on relabel** — TipTip keys bookings on it. Guid regeneration is only safe for brand-new plans (offer as an explicit, separate action).

---

## 2. NOW (0–1 mo) — kill the manual work

| # | Item | Why / What | Prio | Effort | ICE | Kano |
|---|---|---|---|---|---|---|
| N1 | **Seat numbering & labeling wizard** | The headline feature. Scope: **all rows at once** (the thing pretix can't do) or selected rows. Set row names (keep, A–Z, AA–AZ, numeric, custom list, reverse). Set seat numbers (schemes like pretix: 1,2,3… / a,b,c / A,B,C; starting-at; reversed; restart per row or continue). Label template with live preview — default `{row}{n}` (the common organizer convention), presets for `{row}-{n}` and section prefixes (`Q3-{n}`). Writes `seat_number` (TipTip mode) and/or `row_number` + `seat_label` (pretix mode). Never touches `seat_guid`/`uuid` — those are TipTip's seat identifiers. | P0 | M | 567 | Performance |
| N2 | **Render row labels on canvas** | Honor `row_number` + `row_number_position` (start/end/both) like pretix. Needed to *see* what N1 did. | P0 | S | 504 | Basic |
| N3 | **Undo / redo** | Snapshot stack (cap ~50) before each mutation; ⌘Z / ⇧⌘Z. Snapshot approach is fine at this data size; patch-based can come with the NEXT-phase refactor. A bulk tool without undo is dangerous. | P0 | S | 320 | Basic |
| N4 | **Category UX** ✅ shipped | ✅ Alias + counts + assignment merged into one Categories panel. ✅ Duplicate names blocked/warned/recoverable. ✅ UUID format validated on rename (no spaces, must be a UUID). ✅ Color editing (click the swatch), create ("+ Add category") and delete (blocked while seats still use it), click the seat count to select all of a category's seats for bulk reassign. | P1 | S | 432 | Performance |
| N5 | **Replace `alert()`/blocking dialogs with toasts; duplicate-guid report** | Upload currently fires a blocking alert and silently renames 21 duplicate guids — show a non-blocking toast + downloadable report of what changed instead. | P1 | XS | 405 | Basic |
| N6 | **Autosave + recent files** ✅ shipped | ✅ Debounced working copy in localStorage, "Restore last session" on the landing screen, drag-and-drop JSON anywhere to open. Single-slot autosave (a New Plan's first edit overwrites it — export before switching plans); IndexedDB multi-file history deferred to the versioning item in LATER. | P1 | S | 504 | Basic |
| N7 | **Status paint mode** | Pick a status, then click/drag across seats to apply directly — faster than select → dropdown → update for scattered seats. | P2 | S | 392 | Performance |
| N8 | **Find seat / jump to** | Search by label or guid, pan-zoom to result. Invaluable on 4k-seat maps. | P2 | XS | 320 | Performance |
| N9 | **Category display alias** ✅ shipped | Simplified after PM answers: TipTip's importer tolerates extra fields, and no show profiles are needed — just a stable `categories[].label` alias inside the JSON. The Categories panel edits the alias inline (with per-category seat counts); the UUID `name` is swapped per show via the existing rename (which repoints all seats and now preserves the alias). Later, the TipTip Content Hub connection owns event/show info. | P0 | S | 540 | Performance |

✅ Already shipped (June 2026): cursor-anchored zoom/pan, fit-to-content, HiDPI rendering, dark-mode text fix, typing-safe shortcuts — and from this list: **N1 numbering wizard, N2 row labels, N3 undo/redo (⌘Z/⇧⌘Z), N4 category UX, N5 toasts, N6 autosave** (verified against Opus Deccenium: 97 rows / 1,144 seats relabeled in one apply, undo restores). Also: **New Plan flow** — "New" in the toolbar (also while editing) opens a modal with plan name + initial rows × seats-per-row (0 rows = empty plan), fixing the dead-end where a blank plan had no seats and the wizard targeted 0 rows; the wizard's empty state now points at the Insert tool. **Bend selection** — curve any marquee-selected seats (across rows / gaps) from the selection panel. Remaining NOW: N7 status paint, N8 find seat.

---

## 3. NEXT (2–3 mo) — become an editor (pretix parity core)

Maps to the pretix toolbar: select / row-select / seat-grid / single-seat / shapes / text / undo / cut-copy-paste / zoom / grid.

| # | Item | Notes | Prio | Effort |
|---|---|---|---|---|
| X1 | **Architecture refactor** (prerequisite) 🟡 in progress | ✅ File split landed (June 2026): editor 2,513 → 1,653 lines. `model/` (types, pure ops, `metrics` content-bounds), `engine/` (`render` scene painter, `hit-test`, `useViewport` zoom/pan/fit + HiDPI + wheel, `useHistory` snapshot undo), `panels/` (toolbar, properties, numbering wizard, new-plan / insert / json-output modals). Behavior verified identical in-browser. Remaining: `tools/` (one state machine per tool — deferred until X3/X5 add real tools), central reducer store + patch-based undo (snapshot undo is fine at this data size, so low priority). | P0 | M |
| X2 | **Object transform + contextual sidebar** 🟡 in progress | ✅ Contextual sidebar (shipped earlier: plan / row / seat / shape panels). ✅ Move single objects, keyboard nudge, delete key. ✅ **On-canvas resize handles** (`engine/transform.ts`, June 2026): 8 handles on rectangles/ellipses, 4 corner handles on circles (uniform), opposite edge/corner stays fixed, rotation-aware (correct on rotated ellipses), min-size clamp, screen-constant handle size, hover resize-cursors, one undo step per drag, panel dimension fields sync on release. Verified in-browser + 14 unit assertions on the box math. Remaining: rotate handle, shift multi-select, marquee in object mode. | P0 | M–L |
| X3 | **Add seats: grid & row tools** | Click-drag to stamp an n×m seat grid with spacing controls; add a single row; append/insert seats in a row; set default radius/category. | P0 | L |
| X4 | **Curved row tool** (v1 shipped) | ✅ Sagitta slider + numeric on the row panel with live preview, single-undo drags, straighten. PM feedback June 2026: works, but hard to scale across many sections/rows — next iteration needs multi-row curving (apply one bend to N selected rows), an on-canvas bend handle, and arc-length-normalized spacing (estimate currently drifts up after strong bends). | P0 | M |
| X5 | **Shape drawing** | Rectangle, circle/ellipse, polygon (click-to-place vertices, drag to edit, double-click to finish), standalone text. Style panel: fill, border, rotation, text. | P1 | L |
| X6 | **Copy / paste / duplicate** | Within and across zones; pasted seats get fresh uuids/guids; smart label offset (paste row "A" → suggest "B"). | P1 | M |
| X7 | **Snap & grid** | Toggleable grid, snap-to-grid and snap-to-alignment guides while dragging. | P1 | S |
| X8 | **Zones management** | Create/rename/reorder zones (floors), move selection between zones, per-zone visibility toggle. | P2 | M |
| X9 | **Plan settings panel** | Name (exists), width/height editing, "trim canvas size to content" action, total seat count. | P2 | XS |

---

## 4. LATER (3–6 mo) — finish & delight

| Item | Notes | Prio | Effort |
|---|---|---|---|
| Background image tracing | Upload reference image, opacity slider, not saved into the JSON (pretix behavior). | P2 | S |
| Validation panel | Duplicate guids/labels, overlapping seats, seats without category, empty rows — with click-to-locate. | P2 | S |
| Minimap | Overview inset for very large plans. | P3 | S |
| PDF/PNG export | Print-quality plan export. | P3 | M |
| Multi-plan workspace / file versioning | Named saves, version history. | P3 | M |
| TipTip Retool round-trip | Direct import/export against the Retool-managed store instead of manual JSON copy. ⚠ Needs TipTip API access — flag before building (tool standards / approval). | P3 | M–L |
| **AI plan generation** | Upload a venue photo/map + spreadsheet (colors = categories) + ticket UUID list → AI drafts the seating JSON (zones, rows, curves, categories) for human cleanup in the editor. Editor-first foundation work (X1–X5) is a prerequisite so generated output is correctable. | P3 | XL |
| **Embed in TipTip Content Hub (EO portal)** | Run the editor inside the creator portal: save plans directly to TipTip, live per-seat status (sold/unavailable) instead of manual JSON round-trips. Adopt the Content Hub design language (dark sidebar, TipTip red `#E61D54`-family accents, light content surfaces — see dashboard reference). ⚠ Product/eng dependency on TipTip platform team. | P3 | XL |

---

## 5. Phase flow

```mermaid
flowchart LR
  subgraph NOW [NOW · 0–1 mo]
    N1[Numbering & labeling wizard]
    N2[Row labels on canvas]
    N3[Undo/redo snapshots]
    N4[Category UX]
    N9[Show profiles: ticket-UUID mapping]
    N5[Toasts + guid report]
  end
  subgraph NEXT [NEXT · 2–3 mo]
    X1[Architecture refactor]
    X2[Transform & multi-select]
    X3[Seat grid / row tools]
    X4[Curved row tool]
    X5[Shapes & text]
  end
  subgraph LATER [LATER · 3–6 mo]
    L1[Background tracing]
    L2[Validation panel]
    L3[Export & versioning]
  end
  N1 --> N2
  N4 --> N9
  N3 --> X1
  X1 --> X2 --> X3 --> X4
  X1 --> X5
  NEXT --> LATER
```

## 6. Target architecture (NEXT phase)

```mermaid
flowchart TD
  subgraph store [Store - reducer + undo patches]
    M[model: SeatPlan types + pure ops<br/>numbering, curve, transform, validate]
  end
  subgraph engine [Canvas engine]
    V[viewport: zoom/pan/fit - shipped]
    R[renderer: static bitmap + culled vector - shipped]
    H[hit-testing & snapping]
  end
  subgraph tools [Tool state machines]
    T1[select / marquee]
    T2[row tools: add, number, curve]
    T3[shape tools: rect, ellipse, polygon, text]
    T4[status paint]
  end
  subgraph ui [React panels]
    P1[left: modes, status, categories]
    P2[right: properties of selection]
    P3[modals: numbering wizard, validation]
  end
  tools --> store
  ui --> store
  store --> engine
  engine --> ui
```

## 7. Decisions & remaining questions

Answered (June 2026):
- **Label convention:** organizer-dependent, most common `{row}{n}` via seat_label `A%s` → wizard defaults to `{row}{n}` with presets for separators/sections. The pain is that pretix requires setting the template per row; the wizard applies it across all rows in one action.
- **Guid sync:** not needed — TipTip uses each seat's UID as the identifier. The editor never rewrites `seat_guid`/`uuid`.
- **Zones:** pretix-style zones unused in TipTip; single map, zone encoded in seat numbers when needed. Single-zone-first editor is fine.
- **Sidebar pattern:** adopt pretix's context-sensitive panel (canvas / shape / text / row / seat) — see X2.

Also answered (June 2026):
- **TipTip importer tolerates unknown JSON fields** → `categories[].label` alias lives in-file (N9 shipped this way).
- **No show profiles needed** — the alias alone covers it; event/show information becomes TipTip's job once the Content Hub connection exists.
- **X3/X4 authoring confirmed must-have** for the editor phase.
- Wizard UI feedback: works, but the layout isn't final — restructure it into the contextual sidebar when X2 lands.
