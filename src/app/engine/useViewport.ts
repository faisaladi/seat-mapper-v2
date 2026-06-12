// Figma-style canvas viewport: cursor-anchored zoom, pan, fit-to-content,
// HiDPI backing-store sizing and the rAF redraw loop. View state lives in a
// ref so wheel/drag updates never trigger a React re-render; only the zoom %
// readout is mirrored in state.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewState, Bounds, Position } from '../model/types';

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;

export interface Viewport {
  viewRef: React.RefObject<ViewState>;
  dprRef: React.RefObject<number>;
  // The composer assigns its draw closure here; the loop always calls the latest
  drawRef: React.RefObject<() => void>;
  zoomPct: number;
  requestRedraw: () => void;
  applyView: (mutate: (v: ViewState) => void) => void;
  zoomAt: (sx: number, sy: number, factor: number) => void;
  zoomAtCenter: (factor: number) => void;
  fitToContent: () => void;
  resetZoom: () => void;
  screenToWorld: (clientX: number, clientY: number) => Position;
}

export const useViewport = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  bounds: Bounds,
  active: boolean
): Viewport => {
  const viewRef = useRef<ViewState>({ scale: 1, x: 0, y: 0 });
  const dprRef = useRef<number>(1);
  const rafRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const [zoomPct, setZoomPct] = useState<number>(100);

  const requestRedraw = useCallback((): void => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawRef.current();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Keep at least `margin` px of content visible so the map can never be lost off-screen
  const clampView = useCallback((view: ViewState): void => {
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = dprRef.current;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    const b = bounds;
    const margin = 80;
    const left = b.x * view.scale + view.x;
    const right = (b.x + b.w) * view.scale + view.x;
    const top = b.y * view.scale + view.y;
    const bottom = (b.y + b.h) * view.scale + view.y;
    if (right < margin) view.x += margin - right;
    else if (left > cw - margin) view.x -= left - (cw - margin);
    if (bottom < margin) view.y += margin - bottom;
    else if (top > ch - margin) view.y -= top - (ch - margin);
  }, [canvasRef, bounds]);

  const applyView = useCallback((mutate: (v: ViewState) => void): void => {
    const view = viewRef.current;
    mutate(view);
    clampView(view);
    setZoomPct(Math.round(view.scale * 100));
    requestRedraw();
  }, [clampView, requestRedraw]);

  // Zoom keeping the screen point (sx, sy) fixed — i.e. zoom toward the cursor
  const zoomAt = useCallback((sx: number, sy: number, factor: number): void => {
    applyView(v => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = next / v.scale;
      v.x = sx - (sx - v.x) * k;
      v.y = sy - (sy - v.y) * k;
      v.scale = next;
    });
  }, [applyView]);

  const zoomAtCenter = useCallback((factor: number): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = dprRef.current;
    zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, factor);
  }, [canvasRef, zoomAt]);

  const fitToContent = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw < 10 || ch < 10) return;
    const b = bounds;
    applyView(v => {
      v.scale = Math.min(1.5, Math.max(MIN_SCALE, Math.min(cw / b.w, ch / b.h) * 0.97));
      v.x = (cw - b.w * v.scale) / 2 - b.x * v.scale;
      v.y = (ch - b.h * v.scale) / 2 - b.y * v.scale;
    });
  }, [containerRef, applyView, bounds]);

  const resetZoom = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = dprRef.current;
    zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, 1 / viewRef.current.scale);
  }, [canvasRef, zoomAt]);

  const screenToWorld = useCallback((clientX: number, clientY: number): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }, [canvasRef]);

  // Size the canvas backing store to its container (device-pixel aware, so
  // rendering is crisp on HiDPI displays)
  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 1 || h < 1) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      requestRedraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, canvasRef, requestRedraw, active]);

  // Wheel must be a native non-passive listener: React's synthetic onWheel is
  // passive, so preventDefault() there can't stop the browser's own page
  // zoom/scroll from fighting the canvas (the old "clunky pinch" behavior).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 15;
        dy *= 15;
      }
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch (sent as ctrl+wheel) or Ctrl/Cmd + scroll: zoom to cursor.
        // Exponential mapping keeps the rate proportional to the gesture.
        const clamped = Math.max(-25, Math.min(25, dy));
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-clamped * 0.01));
      } else {
        // Plain scroll / two-finger swipe: pan
        applyView(v => {
          v.x -= dx;
          v.y -= dy;
        });
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef, zoomAt, applyView, active]);

  return {
    viewRef,
    dprRef,
    drawRef,
    zoomPct,
    requestRedraw,
    applyView,
    zoomAt,
    zoomAtCenter,
    fitToContent,
    resetZoom,
    screenToWorld,
  };
};
