// Pure geometry for on-canvas resize handles. A resizable area is reduced to
// an oriented box (center + half-extents + rotation); handles live in the
// box's local frame and are transformed to world space for drawing and
// hit-testing. Resizing keeps the opposite edge/corner fixed.

import type { Area } from '../model/types';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface TransformBox {
  cx: number; // world center
  cy: number;
  hx: number; // half-extent along local x
  hy: number; // half-extent along local y
  rot: number; // radians
}

interface HandleDef { id: HandleId; sx: -1 | 0 | 1; sy: -1 | 0 | 1; }

const HANDLES: HandleDef[] = [
  { id: 'nw', sx: -1, sy: -1 }, { id: 'n', sx: 0, sy: -1 }, { id: 'ne', sx: 1, sy: -1 },
  { id: 'e', sx: 1, sy: 0 }, { id: 'se', sx: 1, sy: 1 }, { id: 's', sx: 0, sy: 1 },
  { id: 'sw', sx: -1, sy: 1 }, { id: 'w', sx: -1, sy: 0 },
];

// Which shapes get on-canvas resize handles, and whether they resize uniformly
// (circles keep a single radius, so only corner handles and a square aspect).
export const isResizable = (area: Area): boolean =>
  (area.shape === 'rectangle' && !!area.rectangle) ||
  (area.shape === 'circle' && area.circle?.radius != null) ||
  (area.shape === 'ellipse' && !!area.ellipse?.radius);

export const isUniform = (area: Area): boolean => area.shape === 'circle';

// Build the oriented box for a resizable area in world coordinates.
// `position` is top-left for rectangles, center for circles/ellipses.
export const areaToBox = (area: Area, zoneX: number, zoneY: number): TransformBox | null => {
  const px = area.position.x + zoneX;
  const py = area.position.y + zoneY;
  if (area.shape === 'rectangle' && area.rectangle) {
    return { cx: px + area.rectangle.width / 2, cy: py + area.rectangle.height / 2, hx: area.rectangle.width / 2, hy: area.rectangle.height / 2, rot: 0 };
  }
  if (area.shape === 'circle' && area.circle?.radius != null) {
    return { cx: px, cy: py, hx: area.circle.radius, hy: area.circle.radius, rot: 0 };
  }
  if (area.shape === 'ellipse' && area.ellipse?.radius) {
    return { cx: px, cy: py, hx: area.ellipse.radius.x, hy: area.ellipse.radius.y, rot: ((area.rotation || 0) * Math.PI) / 180 };
  }
  return null;
};

export interface PlacedHandle { id: HandleId; sx: number; sy: number; x: number; y: number; }

export const handleWorldPositions = (box: TransformBox, cornersOnly: boolean): PlacedHandle[] => {
  const c = Math.cos(box.rot), s = Math.sin(box.rot);
  return HANDLES
    .filter(h => !cornersOnly || (h.sx !== 0 && h.sy !== 0))
    .map(h => {
      const lx = h.sx * box.hx, ly = h.sy * box.hy;
      return { id: h.id, sx: h.sx, sy: h.sy, x: box.cx + lx * c - ly * s, y: box.cy + lx * s + ly * c };
    });
};

// Nearest handle within `tol` world units of (px,py), or null.
export const hitHandle = (box: TransformBox, px: number, py: number, tol: number, cornersOnly: boolean): HandleId | null => {
  let best: HandleId | null = null;
  let bestD = tol;
  for (const h of handleWorldPositions(box, cornersOnly)) {
    const d = Math.hypot(px - h.x, py - h.y);
    if (d <= bestD) { bestD = d; best = h.id; }
  }
  return best;
};

// New box after dragging `handle` to world point (px,py). The opposite
// edge/corner stays fixed; `uniform` forces a square (circle) anchored at the
// fixed corner; `minSize` clamps the half-extent.
export const resizeBox = (box: TransformBox, handle: HandleId, px: number, py: number, uniform: boolean, minSize: number): TransformBox => {
  const h = HANDLES.find(x => x.id === handle)!;
  const c = Math.cos(box.rot), s = Math.sin(box.rot);
  const dx = px - box.cx, dy = py - box.cy;
  const plx = dx * c + dy * s;    // pointer in local frame
  const ply = -dx * s + dy * c;

  let cxl = 0, cyl = 0, hx = box.hx, hy = box.hy;
  if (h.sx !== 0) {
    const fixed = -h.sx * box.hx;
    cxl = (plx + fixed) / 2;
    hx = Math.max(minSize, Math.abs(plx - fixed) / 2);
  }
  if (h.sy !== 0) {
    const fixed = -h.sy * box.hy;
    cyl = (ply + fixed) / 2;
    hy = Math.max(minSize, Math.abs(ply - fixed) / 2);
  }

  if (uniform) {
    // Circle: keep a single radius and re-anchor at the fixed corner so the
    // opposite corner doesn't drift while scaling both axes together.
    const r = Math.max(hx, hy);
    hx = r; hy = r;
    if (h.sx !== 0) cxl = h.sx * r - h.sx * box.hx;
    if (h.sy !== 0) cyl = h.sy * r - h.sy * box.hy;
  }

  return {
    cx: box.cx + cxl * c - cyl * s,
    cy: box.cy + cxl * s + cyl * c,
    hx,
    hy,
    rot: box.rot,
  };
};

// Write a resized box back into the area's shape params (mutates `area`).
// `position` stays top-left for rectangles, center for circles/ellipses.
export const applyBoxToArea = (area: Area, box: TransformBox, zoneX: number, zoneY: number): void => {
  if (area.shape === 'rectangle' && area.rectangle) {
    area.rectangle.width = box.hx * 2;
    area.rectangle.height = box.hy * 2;
    area.position.x = box.cx - box.hx - zoneX;
    area.position.y = box.cy - box.hy - zoneY;
  } else if (area.shape === 'circle' && area.circle) {
    area.circle.radius = box.hx;
    area.position.x = box.cx - zoneX;
    area.position.y = box.cy - zoneY;
  } else if (area.shape === 'ellipse' && area.ellipse?.radius) {
    area.ellipse.radius.x = box.hx;
    area.ellipse.radius.y = box.hy;
    area.position.x = box.cx - zoneX;
    area.position.y = box.cy - zoneY;
  }
};

// CSS cursor for a handle, accounting for the box rotation so the arrow points
// the right way on rotated ellipses.
export const handleCursor = (id: HandleId, rot: number): string => {
  const base: Record<HandleId, number> = { e: 0, ne: 45, n: 90, nw: 135, w: 180, sw: 225, s: 270, se: 315 };
  const deg = (base[id] + (rot * 180) / Math.PI) % 180;
  const idx = Math.round(deg / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][idx];
};
