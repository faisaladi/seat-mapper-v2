// Pen-tool geometry: a path is a list of nodes, each with an optional pair of
// bezier handles (absolute control points in the same coordinate space as the
// node). A segment between two nodes is a cubic bezier when either endpoint has
// a facing handle, otherwise a straight line. tessellate() flattens the path
// into plain points for storage/render (pretix polygons only know straight
// points), while the editable `nodes` are kept alongside so curves survive a
// re-open.

export interface Vec { x: number; y: number; }

export interface PenNode {
  x: number;
  y: number;
  hIn?: Vec;  // incoming handle (absolute point)
  hOut?: Vec; // outgoing handle (absolute point)
}

const cubicAt = (p0: Vec, c1: Vec, c2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
};

// Flatten a node path into points. `closed` wraps the last node back to the
// first. Straight segments add a single point; curved segments are sampled.
export const tessellate = (nodes: PenNode[], closed: boolean, perCurve = 16): Vec[] => {
  if (nodes.length < 2) return nodes.map(n => ({ x: n.x, y: n.y }));
  const pts: Vec[] = [{ x: nodes[0].x, y: nodes[0].y }];
  const segs = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const curved = !!a.hOut || !!b.hIn;
    if (!curved) {
      pts.push({ x: b.x, y: b.y });
    } else {
      const c1 = a.hOut ?? { x: a.x, y: a.y };
      const c2 = b.hIn ?? { x: b.x, y: b.y };
      for (let s = 1; s <= perCurve; s++) {
        pts.push(cubicAt({ x: a.x, y: a.y }, c1, c2, { x: b.x, y: b.y }, s / perCurve));
      }
    }
  }
  if (closed) pts.pop(); // the wrap point equals nodes[0]
  return pts;
};

// Axis-aligned bounding box of a set of points.
export const bbox = (pts: Vec[]): { minX: number; minY: number; maxX: number; maxY: number } => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

// Stroke a node path onto a 2D context as beziers (used for the live preview
// and for rendering editable curved polygons). Caller sets styles + begins the
// sub-path origin; this issues moveTo/…/curveTo. Does not fill or stroke.
export const tracePath = (ctx: CanvasRenderingContext2D, nodes: PenNode[], closed: boolean): void => {
  if (nodes.length === 0) return;
  ctx.moveTo(nodes[0].x, nodes[0].y);
  const segs = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const curved = !!a.hOut || !!b.hIn;
    if (!curved) {
      ctx.lineTo(b.x, b.y);
    } else {
      const c1 = a.hOut ?? { x: a.x, y: a.y };
      const c2 = b.hIn ?? { x: b.x, y: b.y };
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
    }
  }
  if (closed) ctx.closePath();
};
