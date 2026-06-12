// Derived geometry over a plan: absolute seat positions and the content
// bounding box. The bounds drive fit-to-content and the static render layer,
// so the view hugs the actual seats/areas instead of the (often oversized)
// JSON `size` field.

import type { SeatData, Zone, Row, Seat, Area, Bounds } from './types';

export interface ContentMetrics {
  bounds: Bounds;
  positions: Map<string, { x: number; y: number; radius: number }>;
}

export const computeContentMetrics = (seatData: SeatData | null): ContentMetrics => {
  const positions = new Map<string, { x: number; y: number; radius: number }>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (x1: number, y1: number, x2: number, y2: number): void => {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  };

  if (seatData) {
    seatData.zones.forEach((zone: Zone) => {
      const zx = zone.position?.x ?? 0;
      const zy = zone.position?.y ?? 0;
      zone.rows.forEach((row: Row) => {
        const rx = row.position?.x ?? 0;
        const ry = row.position?.y ?? 0;
        row.seats.forEach((seat: Seat) => {
          const x = seat.position.x + zx + rx;
          const y = seat.position.y + zy + ry;
          const radius = seat.radius || 8;
          positions.set(seat.seat_guid, { x, y, radius });
          extend(x - radius, y - radius, x + radius, y + radius);
        });
      });
      zone.areas?.forEach((area: Area) => {
        const ax = area.position.x + zx;
        const ay = area.position.y + zy;
        if (area.shape === 'rectangle' && area.rectangle) {
          extend(ax, ay, ax + area.rectangle.width, ay + area.rectangle.height);
        } else if (area.shape === 'circle' && area.circle?.radius) {
          const r = area.circle.radius;
          extend(ax - r, ay - r, ax + r, ay + r);
        } else if (area.shape === 'ellipse' && area.ellipse?.radius) {
          extend(ax - area.ellipse.radius.x, ay - area.ellipse.radius.y, ax + area.ellipse.radius.x, ay + area.ellipse.radius.y);
        } else if (area.shape === 'polygon' && area.polygon?.points) {
          area.polygon.points.forEach(p => extend(ax + p.x, ay + p.y, ax + p.x, ay + p.y));
        } else if (area.shape === 'text' && area.text) {
          const halfW = (area.text.text?.length || 0) * (area.text.size || 16) * 0.35;
          const halfH = area.text.size || 16;
          extend(ax - halfW, ay - halfH, ax + halfW, ay + halfH);
        }
      });
    });
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = seatData?.size?.width || 1000;
    maxY = seatData?.size?.height || 700;
  }
  const pad = 60;
  const bounds: Bounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  return { bounds, positions };
};
