// Pure operations on the seating data model. Every function either returns a
// new SeatData (callers wrap with beginGesture + setSeatData) or mutates a
// row/seat in place on an already-cloned object.

import type { SeatData, Zone, Row, Seat, Area, Position } from './types';

// Seats ordered along the row's dominant axis (ascending = left-to-right).
// Shared by numbering, row layout and row-label rendering.
export const orderedSeatIndices = (row: Row): number[] => {
  const xs = row.seats.map(s => s.position.x);
  const ys = row.seats.map(s => s.position.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const axis: 'x' | 'y' = spreadY > spreadX ? 'y' : 'x';
  return row.seats
    .map((s, i) => ({ i, v: s.position[axis] }))
    .sort((a, b) => a.v - b.v)
    .map(o => o.i);
};

export interface RowLayout {
  spacing: number; // distance between adjacent seats (along the chord)
  sagitta: number; // arc height; 0 = straight, sign = bulge side
}

// Estimate the current layout of a row from its seat positions, so the
// properties panel can show editable values for hand-placed/pretix rows.
export const estimateRowLayout = (row: Row): RowLayout => {
  const order = orderedSeatIndices(row);
  const n = order.length;
  if (n < 2) return { spacing: 25, sagitta: 0 };

  let total = 0;
  for (let i = 1; i < n; i++) {
    const a = row.seats[order[i - 1]].position;
    const b = row.seats[order[i]].position;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const spacing = total / (n - 1);

  const first = row.seats[order[0]].position;
  const last = row.seats[order[n - 1]].position;
  let dx = last.x - first.x;
  let dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { spacing, sagitta: 0 };
  dx /= len;
  dy /= len;
  // signed distance of the middle seat from the chord midpoint, along the
  // left normal (-dy, dx) — same convention as layoutRow
  const mid = row.seats[order[Math.floor(n / 2)]].position;
  const mx = (first.x + last.x) / 2;
  const my = (first.y + last.y) / 2;
  const sagitta = (mid.x - mx) * -dy + (mid.y - my) * dx;
  return { spacing, sagitta };
};

// Re-lay a row's seats along a circular arc: chord starts at the current
// first seat, keeps the current direction, chord length = spacing * (n-1),
// arc height = sagitta (0 = straight line). Mutates seat positions in place.
export const layoutRow = (row: Row, spacing: number, sagitta: number): void => {
  const order = orderedSeatIndices(row);
  const n = order.length;
  if (n === 0) return;

  const first = { ...row.seats[order[0]].position };
  const last = row.seats[order[n - 1]].position;
  let dx = last.x - first.x;
  let dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }

  if (n === 1 || Math.abs(sagitta) < 0.01) {
    order.forEach((seatIdx, i) => {
      row.seats[seatIdx].position = { x: first.x + dx * spacing * i, y: first.y + dy * spacing * i };
    });
    return;
  }

  const chord = spacing * (n - 1);
  const s = Math.abs(sagitta);
  const R = (chord * chord) / (8 * s) + s / 2;
  const half = Math.asin(Math.min(1, chord / 2 / R));
  const sign = sagitta >= 0 ? 1 : -1;
  // left normal of the direction, flipped to the bulge side
  const nx = -dy * sign;
  const ny = dx * sign;
  const mx = first.x + (dx * chord) / 2;
  const my = first.y + (dy * chord) / 2;
  // circle center sits opposite the bulge: apex - normal * R
  const cx = mx + nx * s - nx * R;
  const cy = my + ny * s - ny * R;

  const a0 = Math.atan2(first.y - cy, first.x - cx);
  // sweep direction: from first endpoint towards the apex
  const v0x = first.x - cx;
  const v0y = first.y - cy;
  const vax = mx + nx * s - cx;
  const vay = my + ny * s - cy;
  const dir = Math.sign(v0x * vay - v0y * vax) || 1;

  order.forEach((seatIdx, i) => {
    const t = i / (n - 1);
    const ang = a0 + dir * 2 * half * t;
    row.seats[seatIdx].position = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });
};

const newSeat = (x: number, y: number, num: number, radius: number, category: string): Seat => {
  const id = crypto.randomUUID();
  return {
    uuid: id,
    seat_guid: id,
    seat_number: String(num),
    position: { x, y },
    category,
    radius,
    status: 'AVAILABLE',
  };
};

export interface InsertOptions {
  rows: number;
  seatsPerRow: number;
  spacing: number;     // seat spacing within a row
  rowSpacing: number;  // distance between rows
  radius: number;
  category: string;
}

// Insert a block of rows × seats at a world position (top-left seat center).
// Returns the new rows so the caller can select them.
export const insertSeatBlock = (data: SeatData, zoneIndex: number, at: Position, opts: InsertOptions): Row[] => {
  const zone: Zone = data.zones[zoneIndex];
  const zx = zone.position?.x ?? 0;
  const zy = zone.position?.y ?? 0;
  const added: Row[] = [];
  for (let r = 0; r < opts.rows; r++) {
    const row: Row = {
      uuid: crypto.randomUUID(),
      position: { x: at.x - zx, y: at.y - zy + r * opts.rowSpacing },
      row_number: '',
      seats: [],
    };
    for (let c = 0; c < opts.seatsPerRow; c++) {
      row.seats.push(newSeat(c * opts.spacing, 0, c + 1, opts.radius, opts.category));
    }
    zone.rows.push(row);
    added.push(row);
  }
  return added;
};

// Remove seats by guid; rows left empty are dropped. Returns removed count.
export const deleteSeats = (data: SeatData, guids: Set<string>): number => {
  let removed = 0;
  data.zones.forEach((zone: Zone) => {
    zone.rows.forEach((row: Row) => {
      const before = row.seats.length;
      row.seats = row.seats.filter(s => !guids.has(s.seat_guid));
      removed += before - row.seats.length;
    });
    zone.rows = zone.rows.filter(r => r.seats.length > 0);
  });
  return removed;
};

export const deleteRowAt = (data: SeatData, zoneIndex: number, rowIndex: number): number => {
  const row = data.zones[zoneIndex]?.rows[rowIndex];
  if (!row) return 0;
  const count = row.seats.length;
  data.zones[zoneIndex].rows.splice(rowIndex, 1);
  return count;
};

export const deleteAreaAt = (data: SeatData, zoneIndex: number, areaIndex: number): boolean => {
  const areas = data.zones[zoneIndex]?.areas;
  if (!areas || !areas[areaIndex]) return false;
  areas.splice(areaIndex, 1);
  return true;
};

// Offset a set of seats (bulk nudge / move)
export const offsetSeats = (data: SeatData, guids: Set<string>, dx: number, dy: number): void => {
  data.zones.forEach((zone: Zone) => {
    zone.rows.forEach((row: Row) => {
      row.seats.forEach((seat: Seat) => {
        if (guids.has(seat.seat_guid)) {
          seat.position.x += dx;
          seat.position.y += dy;
        }
      });
    });
  });
};

// Estimate the current sagitta (arc height) of an arbitrary set of seats,
// identified by guid. Works across multiple rows and zones, unlike
// estimateRowLayout which only looks at one row.
export const estimateSelectionSagitta = (data: SeatData, guids: Set<string>): number => {
  const pts: { ax: number; ay: number }[] = [];
  data.zones.forEach((zone: Zone) => {
    const zx = zone.position?.x ?? 0;
    const zy = zone.position?.y ?? 0;
    zone.rows.forEach((row: Row) => {
      const rx = row.position?.x ?? 0;
      const ry = row.position?.y ?? 0;
      row.seats.forEach((seat: Seat) => {
        if (guids.has(seat.seat_guid)) {
          pts.push({ ax: seat.position.x + rx + zx, ay: seat.position.y + ry + zy });
        }
      });
    });
  });
  const n = pts.length;
  if (n < 3) return 0;
  const spreadX = Math.max(...pts.map(p => p.ax)) - Math.min(...pts.map(p => p.ax));
  const spreadY = Math.max(...pts.map(p => p.ay)) - Math.min(...pts.map(p => p.ay));
  pts.sort(spreadY > spreadX ? (a, b) => a.ay - b.ay : (a, b) => a.ax - b.ax);
  const first = pts[0];
  const last = pts[n - 1];
  let dx = last.ax - first.ax;
  let dy = last.ay - first.ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  dx /= len; dy /= len;
  const mid = pts[Math.floor(n / 2)];
  const mx = (first.ax + last.ax) / 2;
  const my = (first.ay + last.ay) / 2;
  return (mid.ax - mx) * -dy + (mid.ay - my) * dx;
};

// Redistribute an arbitrary selection of seats (identified by guid, spanning
// any rows/zones) along a circular arc. The chord runs from the first to last
// seat sorted along the dominant axis; sagitta encodes arc height and direction
// using the same convention as layoutRow.
export const curveSeats = (data: SeatData, guids: Set<string>, sagitta: number): void => {
  interface AbsRef {
    seat: Seat;
    rowX: number; rowY: number;
    zoneX: number; zoneY: number;
    ax: number; ay: number;
  }
  const refs: AbsRef[] = [];
  data.zones.forEach((zone: Zone) => {
    const zoneX = zone.position?.x ?? 0;
    const zoneY = zone.position?.y ?? 0;
    zone.rows.forEach((row: Row) => {
      const rowX = row.position?.x ?? 0;
      const rowY = row.position?.y ?? 0;
      row.seats.forEach((seat: Seat) => {
        if (guids.has(seat.seat_guid)) {
          refs.push({ seat, rowX, rowY, zoneX, zoneY,
            ax: seat.position.x + rowX + zoneX,
            ay: seat.position.y + rowY + zoneY });
        }
      });
    });
  });
  const n = refs.length;
  if (n < 2) return;
  const spreadX = Math.max(...refs.map(r => r.ax)) - Math.min(...refs.map(r => r.ax));
  const spreadY = Math.max(...refs.map(r => r.ay)) - Math.min(...refs.map(r => r.ay));
  refs.sort(spreadY > spreadX ? (a, b) => a.ay - b.ay : (a, b) => a.ax - b.ax);
  const first = refs[0];
  const last = refs[n - 1];
  let dx = last.ax - first.ax;
  let dy = last.ay - first.ay;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-6) return;
  dx /= chord; dy /= chord;

  const place = (r: AbsRef, ax: number, ay: number): void => {
    r.seat.position.x = ax - r.rowX - r.zoneX;
    r.seat.position.y = ay - r.rowY - r.zoneY;
  };

  if (Math.abs(sagitta) < 0.01) {
    refs.forEach((r, i) => {
      const t = i / (n - 1);
      place(r, first.ax + dx * chord * t, first.ay + dy * chord * t);
    });
    return;
  }

  const s = Math.abs(sagitta);
  const R = (chord * chord) / (8 * s) + s / 2;
  const half = Math.asin(Math.min(1, chord / 2 / R));
  const sign = sagitta >= 0 ? 1 : -1;
  const nx = -dy * sign;
  const ny = dx * sign;
  const mx = first.ax + (dx * chord) / 2;
  const my = first.ay + (dy * chord) / 2;
  const cx = mx + nx * s - nx * R;
  const cy = my + ny * s - ny * R;
  const a0 = Math.atan2(first.ay - cy, first.ax - cx);
  const vax = mx + nx * s - cx;
  const vay = my + ny * s - cy;
  const dir = Math.sign((first.ax - cx) * vay - (first.ay - cy) * vax) || 1;
  refs.forEach((r, i) => {
    const ang = a0 + dir * 2 * half * (i / (n - 1));
    place(r, cx + R * Math.cos(ang), cy + R * Math.sin(ang));
  });
};

// ===== Area (shape) factories — coordinates are zone-relative =====
// Defaults match the pretix look: soft fill + saturated border.

export type ShapeKind = 'rectangle' | 'ellipse' | 'text';

export const makeRectArea = (x: number, y: number, w: number, h: number): Area => ({
  uuid: crypto.randomUUID(),
  shape: 'rectangle',
  position: { x, y },
  color: '#dbeafe',
  border_color: '#3b82f6',
  rectangle: { width: w, height: h },
});

export const makeEllipseArea = (cx: number, cy: number, rx: number, ry: number): Area => ({
  uuid: crypto.randomUUID(),
  shape: 'ellipse',
  position: { x: cx, y: cy },
  color: '#fee2e2',
  border_color: '#ef4444',
  ellipse: { radius: { x: rx, y: ry } },
  rotation: 0,
});

export const makeTextArea = (x: number, y: number, text = 'Label'): Area => ({
  uuid: crypto.randomUUID(),
  shape: 'text',
  position: { x, y },
  color: '#111827',
  border_color: '#111827',
  text: { text, color: '#111827', size: 24 },
  rotation: 0,
});

export const makePolygonArea = (
  position: Position,
  points: Position[],
  nodes?: import('./types').PolygonNode[]
): Area => ({
  uuid: crypto.randomUUID(),
  shape: 'polygon',
  position,
  color: '#dcfce7',
  border_color: '#16a34a',
  polygon: nodes ? { points, nodes } : { points },
  rotation: 0,
});

// Append an area to a zone (creating the array if needed). Returns its index.
export const addArea = (data: SeatData, zoneIndex: number, area: Area): number => {
  const zone = data.zones[zoneIndex];
  if (!zone.areas) zone.areas = [];
  zone.areas.push(area);
  return zone.areas.length - 1;
};

// Reorder a shape within its zone's draw order. Areas paint in array order
// (later = on top) and seats always paint after all areas, so this only
// changes stacking relative to other shapes. Returns the area's new index.
export type ArrangeDir = 'front' | 'back' | 'forward' | 'backward';
export const reorderArea = (data: SeatData, zoneIndex: number, areaIndex: number, dir: ArrangeDir): number => {
  const areas = data.zones[zoneIndex]?.areas;
  if (!areas || !areas[areaIndex]) return areaIndex;
  const [area] = areas.splice(areaIndex, 1);
  let target: number;
  if (dir === 'front') target = areas.length;
  else if (dir === 'back') target = 0;
  else if (dir === 'forward') target = Math.min(areas.length, areaIndex + 1);
  else target = Math.max(0, areaIndex - 1);
  areas.splice(target, 0, area);
  return target;
};

// A minimal valid plan for starting from scratch (single zone, TipTip-style)
export const createBlankPlan = (name: string = 'Untitled Plan'): SeatData => ({
  name,
  size: { width: 1500, height: 1800 },
  categories: [
    { name: crypto.randomUUID(), color: '#E61D54', label: 'CAT 1' },
    { name: crypto.randomUUID(), color: '#1D8EF6', label: 'CAT 2' },
    { name: crypto.randomUUID(), color: '#3BAD77', label: 'CAT 3' },
    { name: crypto.randomUUID(), color: '#F9A62A', label: 'CAT 4' },
  ],
  zones: [
    {
      uuid: crypto.randomUUID(),
      zone_id: crypto.randomUUID(),
      name: 'Ground floor',
      position: { x: 0, y: 0 },
      rows: [],
      areas: [],
    },
  ],
});
