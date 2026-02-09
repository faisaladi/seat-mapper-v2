# Seat Rendering: From JSON to Canvas

This document explains how the Seat Map Editor renders a seat map from a JSON file onto an HTML `<canvas>`.

## Overview

- Rendering lives in `src/app/seat-map-editor.tsx` inside the `drawSeatMap` function.
- JSON is loaded via a file input (`FileReader` → `JSON.parse`), then stored in React state `seatData`.
- A canvas (`canvasRef`) is sized from `seatData.size` and redrawn whenever data or selection state changes.

## JSON Structure

Top-level keys used for rendering:

- `name`: Seat map title.
- `size`: `{ width, height }` — canvas dimensions.
- `categories`: `[ { name, color } ]` — map category IDs/names to fill colors.
- `zones`: Array of zone objects:
  - `position`: `{ x, y }` — zone origin.
  - `rows`: Array of row objects:
    - `position`: `{ x, y }` — row origin (relative to zone).
    - `row_number?`: Optional label.
    - `seats`: Array of seat objects:
      - `seat_guid`: Unique ID used for selection. Must be unique across the entire map. The editor will automatically fix duplicates on load.
      - `seat_number`: Label rendered near the seat.
      - `position`: `{ x, y }` — seat position (relative to row).
      - `category`: String matched against `categories[].name` for fill color.
      - `status?`: One of `available | unavailable | void | sold` (controls outline).
      - `radius?`: Optional seat radius (default `8`).
  - `areas?`: Optional decorative/background elements:
    - `shape`: `rectangle | circle | ellipse | text`.
    - `position`: `{ x, y }` — area origin (relative to zone).
    - `color`: Fill color.
    - `border_color`: Stroke color for shapes.
    - `rectangle?`: `{ width, height }`.
    - `circle?`: `{ radius }`.
    - `ellipse?`: `{ radius: { x, y } }`.
    - `text?`: `{ text, color, size }`.
    - `rotation?`: Degrees; applied to text and areas when present.

## Rendering Flow

1. Clear canvas: `ctx.clearRect(0, 0, canvas.width, canvas.height)`.
2. Draw areas (per zone):
   - Compute absolute origin: `area.position + zone.position`.
   - Render shape by `shape`:
     - `rectangle`: `fillRect` and `strokeRect`; optional centered text; optional selection highlight.
     - `circle`: `arc` then `fill`/`stroke`; optional centered text; optional selection highlight.
     - `ellipse`: `ellipse` then `fill`/`stroke`; optional centered text; optional selection highlight.
     - `text`: draw at the area origin; rotation applied if provided.
3. Draw seats (per zone → row → seat):
   - Compute absolute seat position: `seat.position + row.position + zone.position`.
   - Fill with category color resolved from `categories[].name === seat.category`.
   - Outline by status using `statusConfig` mapping.
   - Optional highlight when selected.
   - Draw seat number centered below the seat.
4. Draw selection rectangle if active (rubber-band box during drag).

## Drawing Order

- Canvas uses a painter’s algorithm: later draws appear in front of earlier ones.
- Areas are rendered in the exact JSON order of `zones[].areas`:
  - The first area listed is at the back.
  - Each subsequent area sits in front of the previous ones.
- Seats are always drawn after areas, so seats appear above all areas by default.
- Seats are drawn in JSON order (`zones → rows → seats`); later seats overlay earlier ones if they overlap.
- Selection outlines and the selection rectangle are drawn last, so highlights sit above shapes and seats.

Example: To place a text label over an area, list the area first and the text area later within the same zone’s `areas` array.

## Coordinate System

- All positions are Cartesian pixel coordinates in canvas space.
- Absolute seat position = `zone.position + row.position + seat.position`.
- Absolute area position = `zone.position + area.position`.
- Rotations (for `text` and `ellipse`) are applied around the element’s center using degrees → radians.

## Drawing Details

- Seat circle radius: `seat.radius || 8`.
- Seat fill color: category color or `#cccccc` if not found.
- Seat outline: determined by `statusConfig`:
  - `available`: outline `#22c55e`, width `2`.
  - `unavailable`: outline `#ef4444`, width `2`.
  - `void`: outline `#6b7280`, width `2`.
  - `sold`: outline `#000000`, width `3`.
- Seat label: `ctx.fillText(seat.seat_number, seatX, seatY + 3)` with `10px Arial`.
- Selected seats/areas: highlighted with a yellow (`#fbbf24`) stroke.

## Interaction Hooks Impacting Rendering

While this doc focuses on rendering, selection and dragging affect visuals:

- `findObjectAtPosition(x, y)`: hit-tests seats/areas for selection.
- Dragging toggles a selection rectangle and updates object positions directly; rendering reflects updated positions on each frame.
- `selectedSeats` and `selectedObject` are used to draw highlight outlines.

## Minimal JSON Example

```json
{
  "name": "Example Map",
  "size": { "width": 800, "height": 600 },
  "categories": [
    { "name": "cat-a", "color": "#41CC2C" },
    { "name": "cat-b", "color": "#D45629" }
  ],
  "zones": [
    {
      "name": "Zone 1",
      "position": { "x": 0, "y": 0 },
      "areas": [
        { "shape": "rectangle", "position": { "x": 50, "y": 50 }, "color": "#eeeeee", "border_color": "#333333", "rectangle": { "width": 200, "height": 100 }, "text": { "text": "Court", "color": "#000000", "size": 16 } }
      ],
      "rows": [
        {
          "position": { "x": 100, "y": 200 },
          "row_number": "A",
          "seats": [
            { "seat_guid": "A-1", "seat_number": "1", "position": { "x": 0, "y": 0 }, "category": "cat-a", "status": "available" },
            { "seat_guid": "A-2", "seat_number": "2", "position": { "x": 30, "y": 0 }, "category": "cat-b", "status": "sold" }
          ]
        }
      ]
    }
  ]
}
```

## Extensibility Notes

- Additional shapes can be added by expanding the `Area` interface and `drawSeatMap` switch-like blocks.
- Seat status types can be extended by updating `statusConfig` and ensuring input JSON uses matching keys.
- Category renaming propagates through seats; colors remain coupled to the category entry.

## Key References

- `src/app/seat-map-editor.tsx` — `drawSeatMap`, JSON upload handler, and interactivity.
- `public/Courtside Complimentary.json` — large sample map demonstrating areas, rows, and seats.