# Seat Mapper v2

A browser-based **seat-map authoring & editing tool** for **TipTip** (ticketing
platform). It opens, edits, and exports the seating-plan JSON that TipTip renders
and books against — the same JSON shape as seats.pretix.eu exports, so it doubles
as a pretix-plan editor. Goal: author/edit plans without needing seats.pretix.eu.

Single-user, client-side (no backend). Load a JSON file or start blank, edit on a
canvas, export JSON. Work is autosaved to `localStorage`.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · hand-rolled
`<canvas>` rendering engine.

## Develop

```bash
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type-check (the compile gate)
npm run build
```

## Where things live

- `src/app/seat-map-editor.tsx` — main component (state, input handlers, draw loop)
- `src/app/model/` — pure data: types, mutations/factories, content metrics
- `src/app/engine/` — canvas systems: render, hit-test, transform, pen (beziers),
  snap, viewport hook, history hook
- `src/app/panels/` — React UI (toolbar, properties panel, wizards/modals)
- `docs/pretix-parity-plan.md` — living roadmap & feature status

## For AI agents / contributors

**Read [`CLAUDE.md`](./CLAUDE.md) first** — it covers the architecture, the
TipTip data-model rules you must not break (seat guids, category UUIDs, canvas
size, polygon tessellation), the undo/gesture/selection conventions, and known
gotchas.
