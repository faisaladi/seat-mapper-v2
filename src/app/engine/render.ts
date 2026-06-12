// Pure canvas painting of a plan in world coordinates. No React, no refs —
// callers own the transform (the viewport applies scale/offset before calling)
// and pass a world-space cull rect when painting per-frame at high zoom.

import type { SeatData, Zone, Row, Seat, Area, Bounds } from '../model/types';

export interface StatusConfig {
  outline: string;
  width: number;
}

export const STATUS_CONFIG: Record<string, StatusConfig> = {
  'available': { outline: '#22c55e', width: 2 },
  'unavailable': { outline: '#ef4444', width: 2 },
  'void': { outline: '#6b7280', width: 2 },
  'sold': { outline: '#000000', width: 3 },
};

const paintAreas = (ctx: CanvasRenderingContext2D, seatData: SeatData): void => {
  seatData.zones.forEach((zone: Zone) => {
    if (!zone.areas) return;
    zone.areas.forEach((area: Area) => {
      ctx.save();

      if (area.shape === 'rectangle' && area.rectangle) {
        ctx.fillStyle = area.color;
        ctx.strokeStyle = area.border_color;
        ctx.lineWidth = 1;

        const x = area.position.x + zone.position.x;
        const y = area.position.y + zone.position.y;
        const w = area.rectangle.width;
        const h = area.rectangle.height;

        // Draw in a frame rotated around the rectangle's center
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        if (area.rotation) ctx.rotate((area.rotation * Math.PI) / 180);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        if (area.text && area.text.text && area.text.text.trim() !== '') {
          ctx.fillStyle = area.text.color || '#000000';
          ctx.font = `${area.text.size || 16}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(area.text.text, 0, 0);
        }
        ctx.restore();
      }

      if (area.shape === 'circle' && area.circle?.radius) {
        ctx.fillStyle = area.color;
        ctx.strokeStyle = area.border_color;
        ctx.lineWidth = 1;

        const centerX = area.position.x + zone.position.x;
        const centerY = area.position.y + zone.position.y;
        const radius = area.circle.radius;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        if (area.text && area.text.text && area.text.text.trim() !== '') {
          ctx.fillStyle = area.text.color || '#000000';
          ctx.font = `${area.text.size || 16}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          ctx.save();
          ctx.translate(centerX, centerY);
          if (area.rotation) {
            ctx.rotate((area.rotation * Math.PI) / 180);
          }
          ctx.fillText(area.text.text, 0, 0);
          ctx.restore();
        }
      }

      if (area.shape === 'ellipse' && area.ellipse?.radius) {
        ctx.fillStyle = area.color;
        ctx.strokeStyle = area.border_color;
        ctx.lineWidth = 1;

        const centerX = area.position.x + zone.position.x;
        const centerY = area.position.y + zone.position.y;
        const radiusX = area.ellipse.radius.x;
        const radiusY = area.ellipse.radius.y;

        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, area.rotation ? (area.rotation * Math.PI) / 180 : 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        if (area.text && area.text.text && area.text.text.trim() !== '') {
          ctx.fillStyle = area.text.color || '#000000';
          ctx.font = `${area.text.size || 16}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          ctx.save();
          ctx.translate(centerX, centerY);
          if (area.rotation) {
            ctx.rotate((area.rotation * Math.PI) / 180);
          }
          ctx.fillText(area.text.text, 0, 0);
          ctx.restore();
        }
      }

      if (area.shape === 'polygon' && area.polygon?.points && area.polygon.points.length >= 3) {
        ctx.fillStyle = area.color;
        ctx.strokeStyle = area.border_color;
        ctx.lineWidth = 1;

        const x = area.position.x + zone.position.x;
        const y = area.position.y + zone.position.y;

        ctx.save();
        ctx.translate(x, y);
        if (area.rotation) {
          ctx.rotate((area.rotation * Math.PI) / 180);
        }
        const pts = area.polygon.points;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Text inside polygon uses local text position if provided
        if (area.text && area.text.text && area.text.text.trim() !== '') {
          ctx.fillStyle = area.text.color || '#000000';
          ctx.font = `${area.text.size || 16}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const tx = area.text.position?.x ?? 0;
          const ty = area.text.position?.y ?? 0;
          ctx.fillText(area.text.text, tx, ty);
        }

        ctx.restore();
      }

      if (area.shape === 'text' && area.text) {
        ctx.fillStyle = area.text.color;
        ctx.font = `${area.text.size}px Arial`;
        ctx.textAlign = 'center';

        ctx.save();
        ctx.translate(area.position.x + zone.position.x, area.position.y + zone.position.y);
        if (area.rotation) {
          ctx.rotate((area.rotation * Math.PI) / 180);
        }
        ctx.fillText(area.text.text, 0, 0);
        ctx.restore();
      }

      ctx.restore();
    });
  });
};

const paintSeats = (
  ctx: CanvasRenderingContext2D,
  seatData: SeatData,
  categoryMap: Map<string, string>,
  cull: Bounds | null
): void => {
  seatData.zones.forEach((zone: Zone) => {
    zone.rows.forEach((row: Row) => {
      row.seats.forEach((seat: Seat) => {
        const categoryColor = categoryMap.get(seat.category) || '#cccccc';
        const seatX = seat.position.x + zone.position.x + row.position.x;
        const seatY = seat.position.y + zone.position.y + row.position.y;
        const radius = seat.radius || 8;

        if (cull && (
          seatX + radius < cull.x || seatX - radius > cull.x + cull.w ||
          seatY + radius < cull.y || seatY - radius > cull.y + cull.h
        )) return;

        ctx.beginPath();
        ctx.arc(seatX, seatY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = categoryColor;
        ctx.fill();

        const status = seat.status ? seat.status.toLowerCase() : 'available';
        const statusStyle = STATUS_CONFIG[status] || STATUS_CONFIG['available'];
        ctx.strokeStyle = statusStyle.outline;
        ctx.lineWidth = statusStyle.width;
        ctx.stroke();

        ctx.fillStyle = '#000000';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(seat.seat_number, seatX, seatY + 3);
      });
    });
  });
};

// Row labels at row ends (pretix-style, honoring row_number_position)
const paintRowLabels = (ctx: CanvasRenderingContext2D, seatData: SeatData, cull: Bounds | null): void => {
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  seatData.zones.forEach((zone: Zone) => {
    zone.rows.forEach((row: Row) => {
      const pos = row.row_number_position;
      if (!row.row_number || !pos || row.seats.length === 0) return;

      // Extreme seats along the row's dominant axis
      let first = row.seats[0];
      let last = row.seats[0];
      const xs = row.seats.map(s => s.position.x);
      const ys = row.seats.map(s => s.position.y);
      const axis: 'x' | 'y' = (Math.max(...ys) - Math.min(...ys)) > (Math.max(...xs) - Math.min(...xs)) ? 'y' : 'x';
      row.seats.forEach(s => {
        if (s.position[axis] < first.position[axis]) first = s;
        if (s.position[axis] > last.position[axis]) last = s;
      });

      const baseX = zone.position.x + row.position.x;
      const baseY = zone.position.y + row.position.y;
      let dx = last.position.x - first.position.x;
      let dy = last.position.y - first.position.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) { dx /= len; dy /= len; } else { dx = 1; dy = 0; }
      const offset = (first.radius || 8) + 14;

      const drawLabel = (x: number, y: number): void => {
        if (cull && (x < cull.x - 30 || x > cull.x + cull.w + 30 || y < cull.y - 30 || y > cull.y + cull.h + 30)) return;
        ctx.fillText(row.row_number!, x, y);
      };
      if (pos === 'start' || pos === 'both') {
        drawLabel(baseX + first.position.x - dx * offset, baseY + first.position.y - dy * offset);
      }
      if (pos === 'end' || pos === 'both') {
        drawLabel(baseX + last.position.x + dx * offset, baseY + last.position.y + dy * offset);
      }
    });
  });
  ctx.textBaseline = 'alphabetic';
};

// Paint areas + seats + row labels in world coordinates onto the given
// context. `cull` is a world-space rect: content outside it is skipped (used
// when drawing per-frame at high zoom).
export const paintScene = (
  ctx: CanvasRenderingContext2D,
  seatData: SeatData,
  categoryMap: Map<string, string>,
  cull: Bounds | null
): void => {
  paintAreas(ctx, seatData);
  paintSeats(ctx, seatData, categoryMap, cull);
  paintRowLabels(ctx, seatData, cull);
};
