// Pure snapping helpers. A coordinate snaps to the nearest peer object's
// coordinate (alignment) when within tolerance, otherwise to the grid (when
// enabled). Tolerance is in world units (callers pass screen-px / scale).

export interface AxisSnap {
  value: number;
  guide: number | null; // world coordinate of the alignment guide, if snapped to a peer
}

export const snapAxis = (v: number, targets: number[], grid: number | null, tol: number): AxisSnap => {
  let best: number | null = null;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d <= bestD) { bestD = d; best = t; }
  }
  if (best !== null) return { value: best, guide: best };
  if (grid && grid > 0) return { value: Math.round(v / grid) * grid, guide: null };
  return { value: v, guide: null };
};

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

export interface PointSnap {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
}

// Snap a world point against peer coordinates + grid, independently per axis.
export const snapPoint = (x: number, y: number, targets: SnapTargets, grid: number | null, tol: number): PointSnap => {
  const sx = snapAxis(x, targets.xs, grid, tol);
  const sy = snapAxis(y, targets.ys, grid, tol);
  return { x: sx.value, y: sy.value, guideX: sx.guide, guideY: sy.guide };
};

export const GRID_SIZE = 25; // world units
