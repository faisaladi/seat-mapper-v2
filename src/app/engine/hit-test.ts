// Pure hit-testing over a plan in world coordinates.

import type { SeatData, Position, SelectedObject } from '../model/types';

// Point-in-polygon test using ray casting (expects local coordinates)
export const isPointInPolygon = (px: number, py: number, points: Position[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Find the object (seat or area) at a world position. When several overlap
// and `current` is one of them, the next one in stacking order is returned so
// repeated clicks cycle through the stack.
export const findObjectAtPosition = (
  seatData: SeatData,
  x: number,
  y: number,
  current: SelectedObject | null
): SelectedObject | null => {
  const matchingObjects: SelectedObject[] = [];

  for (let zoneIndex = 0; zoneIndex < seatData.zones.length; zoneIndex++) {
    const zone = seatData.zones[zoneIndex];

    for (let rowIndex = 0; rowIndex < zone.rows.length; rowIndex++) {
      const row = zone.rows[rowIndex];

      for (let seatIndex = 0; seatIndex < row.seats.length; seatIndex++) {
        const seat = row.seats[seatIndex];
        const seatX = seat.position.x + zone.position.x + row.position.x;
        const seatY = seat.position.y + zone.position.y + row.position.y;
        const radius = seat.radius || 8;

        const distance = Math.sqrt(Math.pow(x - seatX, 2) + Math.pow(y - seatY, 2));
        if (distance <= radius) {
          matchingObjects.push({
            type: 'seat',
            id: seat.seat_guid,
            data: seat,
            zoneIndex,
            rowIndex,
            seatIndex
          });
        }
      }
    }

    if (zone.areas) {
      for (let areaIndex = 0; areaIndex < zone.areas.length; areaIndex++) {
        const area = zone.areas[areaIndex];
        const areaX = area.position.x + zone.position.x;
        const areaY = area.position.y + zone.position.y;

        if (area.shape === 'rectangle' && area.rectangle) {
          const w = area.rectangle.width;
          const h = area.rectangle.height;
          // Test in the rectangle's local frame (rotated around its center)
          const cx = areaX + w / 2;
          const cy = areaY + h / 2;
          const rot = ((area.rotation || 0) * Math.PI) / 180;
          const c = Math.cos(-rot), s = Math.sin(-rot);
          const dx = x - cx, dy = y - cy;
          const lx = dx * c - dy * s;
          const ly = dx * s + dy * c;
          if (lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2) {
            matchingObjects.push({
              type: 'area',
              id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
              data: area,
              zoneIndex,
              areaIndex
            });
          }
        }

        if (area.shape === 'circle' && area.circle?.radius) {
          const radius = area.circle.radius;
          const distance = Math.sqrt(Math.pow(x - areaX, 2) + Math.pow(y - areaY, 2));

          if (distance <= radius) {
            matchingObjects.push({
              type: 'area',
              id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
              data: area,
              zoneIndex,
              areaIndex
            });
          }
        }

        if (area.shape === 'ellipse' && area.ellipse?.radius) {
          const radiusX = area.ellipse.radius.x;
          const radiusY = area.ellipse.radius.y;

          const normalizedX = x - areaX;
          const normalizedY = y - areaY;

          if ((Math.pow(normalizedX, 2) / Math.pow(radiusX, 2)) +
              (Math.pow(normalizedY, 2) / Math.pow(radiusY, 2)) <= 1) {
            matchingObjects.push({
              type: 'area',
              id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
              data: area,
              zoneIndex,
              areaIndex
            });
          }
        }

        if (area.shape === 'polygon' && area.polygon?.points && area.polygon.points.length >= 3) {
          const localX = x - areaX;
          const localY = y - areaY;
          if (isPointInPolygon(localX, localY, area.polygon.points)) {
            matchingObjects.push({
              type: 'area',
              id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
              data: area,
              zoneIndex,
              areaIndex
            });
          }
        }

        // Standalone text: drawn centered on its position. Test a generous
        // rotated box around the estimated text extent so it's easy to click.
        if (area.shape === 'text' && area.text) {
          const size = area.text.size || 16;
          const halfW = Math.max(16, (area.text.text?.length || 1) * size * 0.32);
          const halfH = Math.max(10, size * 0.75);
          const rot = ((area.rotation || 0) * Math.PI) / 180;
          const c = Math.cos(-rot), s = Math.sin(-rot);
          const dx = x - areaX, dy = y - areaY;
          const lx = dx * c - dy * s;
          const ly = dx * s + dy * c;
          if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
            matchingObjects.push({
              type: 'area',
              id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
              data: area,
              zoneIndex,
              areaIndex
            });
          }
        }
      }
    }
  }

  if (matchingObjects.length === 0) return null;
  if (matchingObjects.length === 1) return matchingObjects[0];

  // Multiple overlapping objects: cycle from the currently selected one
  if (current) {
    const currentIndex = matchingObjects.findIndex(obj =>
      obj.type === current.type && obj.id === current.id
    );
    if (currentIndex !== -1) {
      return matchingObjects[(currentIndex + 1) % matchingObjects.length];
    }
  }

  return matchingObjects[0];
};
