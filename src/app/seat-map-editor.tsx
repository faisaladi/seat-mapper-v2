/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, Copy, RotateCcw, Save, Edit2, Check, X, Download, MousePointer, Grid3X3, Rows, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Wand2 } from 'lucide-react';
import type { Position, Area, Seat, Row, Zone, Category, SeatData, ViewState, Bounds } from './types';
import NumberingWizard, { NumberingResult } from './numbering-wizard';

interface StatusConfig {
  outline: string;
  width: number;
}

interface SeatStats {
  available: number;
  unavailable: number;
  void: number;
  sold: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error' | 'info';
}

// Define types for selected objects and selection mode
type SelectionMode = 'area' | 'row' | 'object';
type SelectedObject = { type: 'seat' | 'area' | 'row', id: string, data: Seat | Area | Row, zoneIndex: number, rowIndex?: number, seatIndex?: number, areaIndex?: number };

const SeatMapEditor: React.FC = () => {
  const [seatData, setSeatData] = useState<SeatData | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<Position | null>(null);
  const [dragEnd, setDragEnd] = useState<Position | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>('available');
  const [currentCategory, setCurrentCategory] = useState<string>('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('area');
  const [selectedObject, setSelectedObject] = useState<SelectedObject | null>(null);
  const [objectProperties, setObjectProperties] = useState<Record<string, string | number>>({});
  const [isMoveEnabled, setIsMoveEnabled] = useState<boolean>(false);
  const [editCategoryName, setEditCategoryName] = useState<string>('');
  const [editingTitle, setEditingTitle] = useState<boolean>(false);
  const [editTitle, setEditTitle] = useState<string>('');
  const [showOutput, setShowOutput] = useState<boolean>(false);
  const [isDraggingObject, setIsDraggingObject] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<Position | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showWizard, setShowWizard] = useState<boolean>(false);

  // Toast notifications (replaces blocking alert())
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: Toast['type'] = 'success'): void => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Undo / redo: snapshot stack. beginGesture() is called once before every
  // mutation (or at the start of a drag), so one user action = one undo step.
  const undoStackRef = useRef<SeatData[]>([]);
  const redoStackRef = useRef<SeatData[]>([]);
  const [historyVersion, setHistoryVersion] = useState<number>(0);
  const HISTORY_LIMIT = 50;

  const seatDataRef = useRef<SeatData | null>(null);
  seatDataRef.current = seatData;

  const beginGesture = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current) return;
    undoStackRef.current.push(structuredClone(current));
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryVersion(v => v + 1);
  }, []);

  const undo = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current || undoStackRef.current.length === 0) return;
    redoStackRef.current.push(structuredClone(current));
    setSeatData(undoStackRef.current.pop()!);
    setSelectedSeats(new Set());
    setSelectedObject(null);
    setObjectProperties({});
    setHistoryVersion(v => v + 1);
  }, []);

  const redo = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current || redoStackRef.current.length === 0) return;
    undoStackRef.current.push(structuredClone(current));
    setSeatData(redoStackRef.current.pop()!);
    setSelectedSeats(new Set());
    setSelectedObject(null);
    setObjectProperties({});
    setHistoryVersion(v => v + 1);
  }, []);


  // Performance optimizations
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticScaleRef = useRef<number>(1);

  // Memoized category map for O(1) lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (seatData?.categories) {
      seatData.categories.forEach(cat => map.set(cat.name, cat.color));
    }
    return map;
  }, [seatData?.categories]);

  // Seats per category
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    seatData?.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          counts.set(seat.category, (counts.get(seat.category) || 0) + 1);
        });
      });
    });
    return counts;
  }, [seatData]);

  // Content bounding box + absolute seat positions, recomputed when data changes.
  // The bounds drive fit-to-content and the static layer size, so the view hugs
  // the actual seats/areas instead of the (often oversized) JSON `size` field.
  const contentMetrics = useMemo(() => {
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
  }, [seatData]);

  // Viewport state (zoom & pan). Lives in a ref so wheel/drag updates never
  // trigger a React re-render; only the zoom % readout is mirrored in state.
  const viewRef = useRef<ViewState>({ scale: 1, x: 0, y: 0 });
  const dprRef = useRef<number>(1);
  const rafRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const panLastRef = useRef<Position | null>(null);
  const needsFitRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [spaceHeld, setSpaceHeld] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const hasSeatData = Boolean(seatData);

  const MIN_SCALE = 0.02;
  const MAX_SCALE = 8;

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
    const b = contentMetrics.bounds;
    const margin = 80;
    const left = b.x * view.scale + view.x;
    const right = (b.x + b.w) * view.scale + view.x;
    const top = b.y * view.scale + view.y;
    const bottom = (b.y + b.h) * view.scale + view.y;
    if (right < margin) view.x += margin - right;
    else if (left > cw - margin) view.x -= left - (cw - margin);
    if (bottom < margin) view.y += margin - bottom;
    else if (top > ch - margin) view.y -= top - (ch - margin);
  }, [contentMetrics]);

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
  }, [zoomAt]);

  const fitToContent = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw < 10 || ch < 10) return;
    const b = contentMetrics.bounds;
    applyView(v => {
      v.scale = Math.min(1.5, Math.max(MIN_SCALE, Math.min(cw / b.w, ch / b.h) * 0.97));
      v.x = (cw - b.w * v.scale) / 2 - b.x * v.scale;
      v.y = (ch - b.h * v.scale) / 2 - b.y * v.scale;
    });
  }, [applyView, contentMetrics]);

  const resetZoom = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = dprRef.current;
    zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, 1 / viewRef.current.scale);
  }, [zoomAt]);

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
  }, [requestRedraw, hasSeatData]);

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
  }, [zoomAt, applyView, hasSeatData]);

  // Fit the view once after a new file is loaded
  useEffect(() => {
    if (seatData && needsFitRef.current) {
      needsFitRef.current = false;
      fitToContent();
    }
  }, [seatData, fitToContent]);

  // Status configurations
  const statusConfig: Record<string, StatusConfig> = {
    'available': { outline: '#22c55e', width: 2 },
    'unavailable': { outline: '#ef4444', width: 2 },
    'void': { outline: '#6b7280', width: 2 },
    'sold': { outline: '#000000', width: 3 }
  };

  // Validate and fix duplicate IDs in the data
  const validateAndFixData = (data: SeatData): { data: SeatData, fixedCount: number } => {
    const newData = JSON.parse(JSON.stringify(data)); // Deep copy
    const seenSeatIds = new Set<string>();
    let fixedCount = 0;

    // Fix Seat GUIDs
    newData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (seenSeatIds.has(seat.seat_guid)) {
            // Generate a new unique ID
            let newId = seat.seat_guid;
            let counter = 1;
            while (seenSeatIds.has(newId)) {
              newId = `${seat.seat_guid}_copy${counter}`;
              counter++;
            }
            seat.seat_guid = newId;
            fixedCount++;
          }
          seenSeatIds.add(seat.seat_guid);
        });
      });
    });

    return { data: newData, fixedCount };
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          if (!e.target?.result) return;
          const jsonData = JSON.parse(e.target.result as string);
          
          // Validate and fix data
          const { data: validatedData, fixedCount } = validateAndFixData(jsonData);

          if (fixedCount > 0) {
            showToast(`Fixed ${fixedCount} duplicate seat IDs in the uploaded file.`, 'info');
          }

          undoStackRef.current = [];
          redoStackRef.current = [];
          setHistoryVersion(v => v + 1);
          needsFitRef.current = true;
          setSeatData(validatedData);
          setSelectedSeats(new Set());
        } catch (error) {
          showToast('Invalid JSON file', 'error');
        }
      };
      reader.readAsText(file);
    }
  };

  // Handle canvas mouse events
  // Find all seats in a row
  const findSeatsInRow = (zoneIndex: number, rowIndex: number): Set<string> => {
    if (!seatData) return new Set<string>();
    
    const seatsInRow = new Set<string>();
    const row = seatData.zones[zoneIndex].rows[rowIndex];
    
    row.seats.forEach((seat: Seat) => {
      seatsInRow.add(seat.seat_guid);
    });
    
    return seatsInRow;
  };

  const screenToWorld = (clientX: number, clientY: number): Position => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!canvasRef.current || !seatData) return;

    // Middle mouse button or space+drag pans the canvas in any mode
    if (e.button === 1 || spaceHeld) {
      e.preventDefault();
      panLastRef.current = { x: e.clientX, y: e.clientY };
      setIsPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (selectionMode === 'area') {
      // Check if we're clicking on a selected object first
      if (selectedObject && isMoveEnabled) {
        // Get object position based on its type
        let objectX = 0;
        let objectY = 0;
        
        if (selectedObject.type === 'seat') {
          const seat = selectedObject.data as Seat;
          const row = seatData.zones[selectedObject.zoneIndex].rows[selectedObject.rowIndex!];
          objectX = seat.position.x + row.position.x + seatData.zones[selectedObject.zoneIndex].position.x;
          objectY = seat.position.y + row.position.y + seatData.zones[selectedObject.zoneIndex].position.y;
        } else if (selectedObject.type === 'area') {
          const area = selectedObject.data as Area;
          objectX = area.position.x + seatData.zones[selectedObject.zoneIndex].position.x;
          objectY = area.position.y + seatData.zones[selectedObject.zoneIndex].position.y;
        } else if (selectedObject.type === 'row') {
          const row = selectedObject.data as Row;
          objectX = row.position.x + seatData.zones[selectedObject.zoneIndex].position.x;
          objectY = row.position.y + seatData.zones[selectedObject.zoneIndex].position.y;
        }
        
        // Check if click is near the object
        const clickRadius = 20; // Pixels around object that count as clicking it
        const distance = Math.sqrt(Math.pow(x - objectX, 2) + Math.pow(y - objectY, 2));
        
        if (distance <= clickRadius) {
          // Start dragging the object
          beginGesture();
          setIsDraggingObject(true);
          setDragOffset({ x: objectX - x, y: objectY - y });
          return;
        }
      }
      
      // If not dragging an object, start area selection
      setIsDragging(true);
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setSelectedObject(null);
      setSelectedSeats(new Set());
    } else if (selectionMode === 'row') {
      // Find seat under cursor to identify the row
      const object = findObjectAtPosition(x, y);
      if (object && object.type === 'seat' && object.rowIndex !== undefined) {
        // Select the row that contains this seat
        const rowObject: SelectedObject = {
          type: 'row',
          id: `row-${object.zoneIndex}-${object.rowIndex}`,
          data: seatData.zones[object.zoneIndex].rows[object.rowIndex],
          zoneIndex: object.zoneIndex,
          rowIndex: object.rowIndex
        };
        
        setSelectedObject(rowObject);
        setObjectProperties(getObjectProperties(rowObject));
        
        // Select all seats in this row
        setSelectedSeats(findSeatsInRow(object.zoneIndex, object.rowIndex));
        
        // Set up for dragging
        if (isMoveEnabled) {
          const row = seatData.zones[object.zoneIndex].rows[object.rowIndex];
          const rowX = row.position.x + seatData.zones[object.zoneIndex].position.x;
          const rowY = row.position.y + seatData.zones[object.zoneIndex].position.y;
          beginGesture();
          setIsDraggingObject(true);
          setDragOffset({ x: rowX - x, y: rowY - y });
        }
      } else {
        setSelectedObject(null);
        setObjectProperties({});
        setSelectedSeats(new Set());
      }
    } else if (selectionMode === 'object') {
      // Find object under cursor
      const object = findObjectAtPosition(x, y);
      if (object) {
        setSelectedObject(object);
        setObjectProperties(getObjectProperties(object));
        setSelectedSeats(new Set());
        
        // Set up for dragging
        if (isMoveEnabled) {
          let objectX = 0;
          let objectY = 0;
          
          if (object.type === 'seat') {
            const seat = object.data as Seat;
            const row = seatData.zones[object.zoneIndex].rows[object.rowIndex!];
            objectX = seat.position.x + row.position.x + seatData.zones[object.zoneIndex].position.x;
            objectY = seat.position.y + row.position.y + seatData.zones[object.zoneIndex].position.y;
          } else if (object.type === 'area') {
            const area = object.data as Area;
            objectX = area.position.x + seatData.zones[object.zoneIndex].position.x;
            objectY = area.position.y + seatData.zones[object.zoneIndex].position.y;
          }
          beginGesture();
          setIsDraggingObject(true);
          setDragOffset({ x: objectX - x, y: objectY - y });
        }
      } else {
        setSelectedObject(null);
        setObjectProperties({});
        setSelectedSeats(new Set());
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (panLastRef.current) {
      const dx = e.clientX - panLastRef.current.x;
      const dy = e.clientY - panLastRef.current.y;
      panLastRef.current = { x: e.clientX, y: e.clientY };
      applyView(v => {
        v.x += dx;
        v.y += dy;
      });
      return;
    }
    if (!canvasRef.current || !seatData) return;

    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (isDragging) {
      setDragEnd({ x, y });
    } else if (isDraggingObject && selectedObject && dragOffset && isMoveEnabled) {
      // Calculate new position
      const newX = x + dragOffset.x;
      const newY = y + dragOffset.y;
      
      // Update object position directly
      const updatedSeatData = { ...seatData };
      const { type, zoneIndex, rowIndex, seatIndex, areaIndex } = selectedObject;
      
      if (type === 'seat' && rowIndex !== undefined && seatIndex !== undefined) {
        const seat = updatedSeatData.zones[zoneIndex].rows[rowIndex].seats[seatIndex];
        const zone = updatedSeatData.zones[zoneIndex];
        const row = zone.rows[rowIndex];
        
        // Calculate relative position
        const relativeX = newX - zone.position.x - row.position.x;
        const relativeY = newY - zone.position.y - row.position.y;
        
        seat.position.x = relativeX;
        seat.position.y = relativeY;
      } else if (type === 'area' && areaIndex !== undefined && updatedSeatData.zones[zoneIndex].areas) {
        const area = updatedSeatData.zones[zoneIndex].areas![areaIndex];
        const zone = updatedSeatData.zones[zoneIndex];
        
        // Calculate relative position
        const relativeX = newX - zone.position.x;
        const relativeY = newY - zone.position.y;
        
        area.position.x = relativeX;
        area.position.y = relativeY;
      } else if (type === 'row' && rowIndex !== undefined) {
        const row = updatedSeatData.zones[zoneIndex].rows[rowIndex];
        const zone = updatedSeatData.zones[zoneIndex];
        
        // Calculate relative position
        const relativeX = newX - zone.position.x;
        const relativeY = newY - zone.position.y;
        
        row.position.x = relativeX;
        row.position.y = relativeY;
      }
      
      setSeatData(updatedSeatData);
      
      // Update object properties to reflect new position
      if (type === 'row' && rowIndex !== undefined) {
        const updatedRowObject: SelectedObject = {
          type: 'row',
          id: `row-${zoneIndex}-${rowIndex}`,
          data: updatedSeatData.zones[zoneIndex].rows[rowIndex],
          zoneIndex,
          rowIndex
        };
        
        setSelectedObject(updatedRowObject);
        setObjectProperties(getObjectProperties(updatedRowObject));
        
        // Update selected seats to highlight all seats in the row
        setSelectedSeats(findSeatsInRow(zoneIndex, rowIndex));
      } else {
        // For seats and areas, update properties
        if (selectedObject) {
          setObjectProperties(getObjectProperties(selectedObject));
        }
      }
    }
  };

  const handleMouseUp = (): void => {
    if (panLastRef.current) {
      panLastRef.current = null;
      setIsPanning(false);
    }
    if (isDragging && dragStart && dragEnd) {
      selectSeatsInArea();
    }
    setIsDragging(false);
    setIsDraggingObject(false);
    setDragStart(null);
    setDragEnd(null);
    setDragOffset(null);
  };

  // Select seats within drag area
  const selectSeatsInArea = (): void => {
    if (!seatData || !dragStart || !dragEnd) return;

    const minX = Math.min(dragStart.x, dragEnd.x);
    const maxX = Math.max(dragStart.x, dragEnd.x);
    const minY = Math.min(dragStart.y, dragEnd.y);
    const maxY = Math.max(dragStart.y, dragEnd.y);

    const newSelectedSeats = new Set<string>();

    seatData.zones.forEach((zone: Zone) => {
      [...zone.rows].reverse().forEach((row: Row) => {
        [...row.seats].reverse().forEach((seat: Seat) => {
          const seatX = seat.position.x + zone.position.x + row.position.x;
          const seatY = seat.position.y + zone.position.y + row.position.y;
          
          if (seatX >= minX && seatX <= maxX && seatY >= minY && seatY <= maxY) {
            newSelectedSeats.add(seat.seat_guid);
          }
        });
      });
    });

    setSelectedSeats(newSelectedSeats);
  };

  // Update selected seats status
  const updateSelectedSeatsStatus = (): void => {
    if (!seatData || selectedSeats.size === 0) return;

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };
    
    updatedSeatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (selectedSeats.has(seat.seat_guid)) {
            seat.status = currentStatus.toUpperCase();
          }
        });
      });
    });

    setSeatData(updatedSeatData);
    setSelectedSeats(new Set());
  };

  // Update selected seats category
  const updateSelectedSeatsCategory = (): void => {
    if (!seatData || selectedSeats.size === 0 || !currentCategory) return;

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };
    
    updatedSeatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (selectedSeats.has(seat.seat_guid)) {
            seat.category = currentCategory;
          }
        });
      });
    });

    setSeatData(updatedSeatData);
    setSelectedSeats(new Set());
  };

  // Paint areas + seats in world coordinates onto the given context.
  // `cull` is a world-space rect: seats outside it are skipped (used when
  // drawing per-frame at high zoom).
  const paintContent = useCallback((ctx: CanvasRenderingContext2D, cull: Bounds | null): void => {
    if (!seatData) return;

    // Draw areas (background elements)
    seatData.zones.forEach((zone: Zone, zoneIndex: number) => {
      if (zone.areas) {
        zone.areas.forEach((area: Area, areaIndex: number) => {
          ctx.save();
          
          if (area.shape === 'rectangle' && area.rectangle) {
            ctx.fillStyle = area.color;
            ctx.strokeStyle = area.border_color;
            ctx.lineWidth = 1;
            
            const x = area.position.x + zone.position.x;
            const y = area.position.y + zone.position.y;
            
            ctx.fillRect(x, y, area.rectangle.width, area.rectangle.height);
            ctx.strokeRect(x, y, area.rectangle.width, area.rectangle.height);
            
            // Draw text inside rectangle if it exists
            if (area.text && area.text.text && area.text.text.trim() !== '') {
              ctx.fillStyle = area.text.color || '#000000';
              ctx.font = `${area.text.size || 16}px Arial`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              ctx.save();
              ctx.translate(x + area.rectangle.width / 2, y + area.rectangle.height / 2);
              if (area.rotation) {
                ctx.rotate((area.rotation * Math.PI) / 180);
              }
              ctx.fillText(area.text.text, 0, 0);
              ctx.restore();
            }
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
            
            // Draw text inside circle if it exists
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
            
            // Draw text inside ellipse if it exists
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

            // Draw text inside polygon if it exists, using local text position if provided
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
      }
    });

    // Draw seats
    seatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          // Use Map for O(1) lookup
          const categoryColor = categoryMap.get(seat.category) || '#cccccc';
          const seatX = seat.position.x + zone.position.x + row.position.x;
          const seatY = seat.position.y + zone.position.y + row.position.y;
          const radius = seat.radius || 8;

          if (cull && (
            seatX + radius < cull.x || seatX - radius > cull.x + cull.w ||
            seatY + radius < cull.y || seatY - radius > cull.y + cull.h
          )) return;

          // Draw seat circle
          ctx.beginPath();
          ctx.arc(seatX, seatY, radius, 0, 2 * Math.PI);
          ctx.fillStyle = categoryColor;
          ctx.fill();

          // Draw status outline
          const status = seat.status ? seat.status.toLowerCase() : 'available';
          const statusStyle = statusConfig[status] || statusConfig['available'];
          ctx.strokeStyle = statusStyle.outline;
          ctx.lineWidth = statusStyle.width;
          ctx.stroke();

          // Draw seat number
          ctx.fillStyle = '#000000';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(seat.seat_number, seatX, seatY + 3);
        });
      });
    });

    // Row labels at row ends (pretix-style, honoring row_number_position)
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
  }, [seatData, categoryMap]);

  // Render the cached content bitmap, sized to the content bounds within a
  // pixel budget. When the view zooms past this resolution, draw() switches
  // to direct (culled) vector painting so seats stay crisp.
  const renderStaticLayer = useCallback((): void => {
    if (!seatData) return;

    if (!staticCanvasRef.current) {
      staticCanvasRef.current = document.createElement('canvas');
    }
    const canvas = staticCanvasRef.current;
    const b = contentMetrics.bounds;
    const MAX_DIM = 8192;
    const MAX_PIXELS = 16_000_000;
    const scale = Math.min(2, MAX_DIM / b.w, MAX_DIM / b.h, Math.sqrt(MAX_PIXELS / (b.w * b.h)));
    staticScaleRef.current = scale;
    canvas.width = Math.max(1, Math.ceil(b.w * scale));
    canvas.height = Math.max(1, Math.ceil(b.h * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
    ctx.clearRect(b.x, b.y, b.w, b.h);
    paintContent(ctx, null);
  }, [seatData, contentMetrics, paintContent]);

  useEffect(() => {
    renderStaticLayer();
    requestRedraw();
  }, [renderStaticLayer, requestRedraw]);

  // Compose a frame: world transform -> content (bitmap or direct) -> overlays
  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas || !seatData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = dprRef.current;
    const view = viewRef.current;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // World transform: screen = world * scale + offset
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

    const b = contentMetrics.bounds;

    // White content card so the map extent reads against the gray backdrop
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    const effectiveScale = view.scale * dpr;
    if (staticCanvasRef.current && effectiveScale <= staticScaleRef.current * 1.4) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(staticCanvasRef.current, b.x, b.y, b.w, b.h);
    } else {
      // Zoomed in past the bitmap's resolution: paint visible seats directly
      const cull: Bounds = {
        x: -view.x / view.scale,
        y: -view.y / view.scale,
        w: cw / view.scale,
        h: ch / view.scale,
      };
      paintContent(ctx, cull);
    }

    // Overlay stroke widths are divided by scale so they stay constant on screen
    // Draw Area Highlights (Selected Object)
    if (selectedObject?.type === 'area') {
        const zone = seatData.zones[selectedObject.zoneIndex];
        if (zone && zone.areas && selectedObject.areaIndex !== undefined) {
            const area = zone.areas[selectedObject.areaIndex];
            const x = area.position.x + zone.position.x;
            const y = area.position.y + zone.position.y;

            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 3 / view.scale;

            if (area.shape === 'rectangle' && area.rectangle) {
                ctx.strokeRect(x - 2, y - 2, area.rectangle.width + 4, area.rectangle.height + 4);
            } else if (area.shape === 'circle' && area.circle?.radius) {
                ctx.beginPath();
                ctx.arc(x, y, area.circle.radius + 2, 0, 2 * Math.PI);
                ctx.stroke();
            } else if (area.shape === 'ellipse' && area.ellipse?.radius) {
                const rx = area.ellipse.radius.x;
                const ry = area.ellipse.radius.y;
                ctx.beginPath();
                ctx.ellipse(x, y, rx + 2, ry + 2, area.rotation ? (area.rotation * Math.PI) / 180 : 0, 0, 2 * Math.PI);
                ctx.stroke();
            } else if (area.shape === 'polygon' && area.polygon?.points) {
                ctx.save();
                ctx.translate(x, y);
                if (area.rotation) ctx.rotate((area.rotation * Math.PI) / 180);
                const pts = area.polygon.points;
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    // Highlight selected seats
    if (selectedSeats.size > 0) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3 / view.scale;

        selectedSeats.forEach(seatGuid => {
            const pos = contentMetrics.positions.get(seatGuid);
            if (pos) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, pos.radius + 3, 0, 2 * Math.PI);
                ctx.stroke();
            }
        });
    }

    // Highlight single selected object seat
    if (selectedObject?.type === 'seat') {
        const pos = contentMetrics.positions.get(selectedObject.id);
        if (pos) {
             ctx.strokeStyle = '#fbbf24';
             ctx.lineWidth = 3 / view.scale;
             ctx.beginPath();
             ctx.arc(pos.x, pos.y, pos.radius + 3, 0, 2 * Math.PI);
             ctx.stroke();
        }
    }

    // Draw selection rectangle
    if (isDragging && dragStart && dragEnd) {
      const rx = Math.min(dragStart.x, dragEnd.x);
      const ry = Math.min(dragStart.y, dragEnd.y);
      const rw = Math.abs(dragEnd.x - dragStart.x);
      const rh = Math.abs(dragEnd.y - dragStart.y);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5 / view.scale;
      ctx.setLineDash([6 / view.scale, 4 / view.scale]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [seatData, contentMetrics, paintContent, selectedSeats, isDragging, dragStart, dragEnd, selectedObject]);

  // Keep the rAF loop pointed at the latest draw closure; redraw on state changes
  useEffect(() => {
    drawRef.current = draw;
    requestRedraw();
  }, [draw, requestRedraw]);

  // Initialize currentCategory when seatData loads
  useEffect(() => {
    if (seatData && seatData.categories && seatData.categories.length > 0 && !currentCategory) {
      setCurrentCategory(seatData.categories[0].name);
    }
  }, [seatData, currentCategory]);

  // Update category name
  const updateCategoryName = (categoryId: string, newName: string): void => {
    if (!seatData || !newName.trim()) return;

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };
    const categoryIndex = updatedSeatData.categories.findIndex((cat: Category) => cat.name === categoryId);
    
    if (categoryIndex !== -1) {
      const oldName = updatedSeatData.categories[categoryIndex].name;

      // Update the name (ticket UUID) while preserving color, label and any
      // other fields — the alias must survive per-show UUID swaps
      updatedSeatData.categories[categoryIndex] = {
        ...updatedSeatData.categories[categoryIndex],
        name: newName.trim()
      };
      
      // Update all seats that reference this category
      updatedSeatData.zones.forEach((zone: Zone) => {
        zone.rows.forEach((row: Row) => {
          row.seats.forEach((seat: Seat) => {
            if (seat.category === oldName) {
              seat.category = newName.trim();
            }
          });
        });
      });
    }

    setSeatData(updatedSeatData);
    setEditingCategory(null);
    setEditCategoryName('');
  };

  // Update category display alias (stored as categories[].label inside the
  // JSON — TipTip's importer tolerates the extra field, so the readable name
  // survives the per-show ticket-UUID swap of `name`)
  const updateCategoryLabel = (categoryName: string, label: string): void => {
    if (!seatData) return;
    const trimmed = label.trim();
    const idx = seatData.categories.findIndex((c: Category) => c.name === categoryName);
    if (idx === -1) return;
    if ((seatData.categories[idx].label || '') === trimmed) return;
    beginGesture();
    setSeatData({
      ...seatData,
      categories: seatData.categories.map((c: Category, i: number) =>
        i === idx ? { ...c, label: trimmed || undefined } : c
      ),
    });
  };

  // Start editing category
  const startEditingCategory = (categoryId: string, currentName: string): void => {
    setEditingCategory(categoryId);
    setEditCategoryName(currentName);
  };

  // Cancel editing category
  const cancelEditingCategory = (): void => {
    setEditingCategory(null);
    setEditCategoryName('');
  };

  // Show JSON output modal
  const showJSONOutput = (): void => {
    if (!seatData) return;
    setShowOutput(true);
  };

  // Reset selection
  const resetSelection = (): void => {
    setSelectedSeats(new Set());
  };

  // Get seat counts by status
  const getSeatStats = (): SeatStats => {
    if (!seatData) return { available: 0, unavailable: 0, void: 0, sold: 0 };
    
    const stats: SeatStats = { available: 0, unavailable: 0, void: 0, sold: 0 };
    
    seatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          const status = seat.status ? seat.status.toLowerCase() : 'available';
          if (status in stats) {
            stats[status as keyof SeatStats]++;
          }
        });
      });
    });
    
    return stats;
  };

  // Point-in-polygon test using ray casting algorithm (expects local coordinates)
  const isPointInPolygon = (px: number, py: number, points: Position[]): boolean => {
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

  // Find object at position
  const findObjectAtPosition = (x: number, y: number): SelectedObject | null => {
    if (!seatData) return null;
    
    // Store all objects that match the position
    const matchingObjects: SelectedObject[] = [];
    
    // Check for seats first
    for (let zoneIndex = 0; zoneIndex < seatData.zones.length; zoneIndex++) {
      const zone = seatData.zones[zoneIndex];
      
      for (let rowIndex = 0; rowIndex < zone.rows.length; rowIndex++) {
        const row = zone.rows[rowIndex];
        
        for (let seatIndex = 0; seatIndex < row.seats.length; seatIndex++) {
          const seat = row.seats[seatIndex];
          const seatX = seat.position.x + zone.position.x + row.position.x;
          const seatY = seat.position.y + zone.position.y + row.position.y;
          const radius = seat.radius || 8;
          
          // Check if click is within seat circle
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
      
      // Check for areas
      if (zone.areas) {
        for (let areaIndex = 0; areaIndex < zone.areas.length; areaIndex++) {
          const area = zone.areas[areaIndex];
          const areaX = area.position.x + zone.position.x;
          const areaY = area.position.y + zone.position.y;
          
          // Check if click is within rectangle area
          if (area.shape === 'rectangle' && area.rectangle) {
            if (
              x >= areaX && 
              x <= areaX + area.rectangle.width && 
              y >= areaY && 
              y <= areaY + area.rectangle.height
            ) {
              matchingObjects.push({
                type: 'area',
                id: area.uuid || `area-${zoneIndex}-${areaIndex}`,
                data: area,
                zoneIndex,
                areaIndex
              });
            }
          }
          
          // Check if click is within circle area
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
          
          // Check if click is within ellipse area
          if (area.shape === 'ellipse' && area.ellipse?.radius) {
            const radiusX = area.ellipse.radius.x;
            const radiusY = area.ellipse.radius.y;
            
            // Normalize the point to the ellipse's coordinate system
            const normalizedX = x - areaX;
            const normalizedY = y - areaY;
            
            // Check if point is inside ellipse using the ellipse equation
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

          // Check if click is within polygon area
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
        }
      }
    }
    
    // If no objects found, return null
    if (matchingObjects.length === 0) return null;
    
    // If only one object found, return it
    if (matchingObjects.length === 1) return matchingObjects[0];
    
    // If multiple objects found and we have a selected object already,
    // cycle through them to select the next one
    if (selectedObject) {
      const currentIndex = matchingObjects.findIndex(obj => 
        obj.type === selectedObject.type && obj.id === selectedObject.id
      );
      
      if (currentIndex !== -1) {
        // Return the next object in the array (or the first if we're at the end)
        return matchingObjects[(currentIndex + 1) % matchingObjects.length];
      }
    }
    
    // Default to the first matching object
    return matchingObjects[0];
  };
  
  // Get object properties for editing
  const getObjectProperties = (object: SelectedObject): Record<string, string | number> => {
    if (object.type === 'seat') {
      const seat = object.data as Seat;
      return {
        seat_number: seat.seat_number,
        category: seat.category,
        status: seat.status || 'available',
        position_x: seat.position.x,
        position_y: seat.position.y,
        radius: seat.radius || 8
      };
    } else if (object.type === 'row') {
      const row = object.data as Row;
      // Count seats in this row
      const seatCount = row.seats.length;
      
      return {
        row_number: row.row_number || '',
        position_x: row.position.x,
        position_y: row.position.y,
        seat_count: seatCount
      };
    } else if (object.type === 'area') {
      const area = object.data as Area;
      const properties: Record<string, string | number> = {
        shape: area.shape,
        color: area.color,
        border_color: area.border_color,
        position_x: area.position.x,
        position_y: area.position.y,
        rotation: area.rotation || 0
      };
      
      if (area.rectangle) {
        properties.width = area.rectangle.width;
        properties.height = area.rectangle.height;
      }
      
      if (area.circle?.radius != null) {
        properties.radius = area.circle.radius;
      }
      
      if (area.ellipse?.radius) {
        properties.radius_x = area.ellipse.radius.x || 0;
        properties.radius_y = area.ellipse.radius.y || 0;
      }
      
      if (area.text) {
        properties.text = area.text.text || '';
        properties.text_color = area.text.color || '#000000';
        properties.text_size = area.text.size || 16;
      }
      
      return properties;
    }
    
    return {};
  };
  
  // Update object property
  const updateObjectProperty = (property: string, value: string | number): void => {
    if (!selectedObject || !seatData) return;
    
    const updatedSeatData = { ...seatData };
    const { type, zoneIndex, rowIndex, seatIndex, areaIndex } = selectedObject;
    
    if (type === 'seat' && rowIndex !== undefined && seatIndex !== undefined) {
      const seat = updatedSeatData.zones[zoneIndex].rows[rowIndex].seats[seatIndex];
      
      // Handle special cases for nested properties
      if (property === 'position_x') {
        seat.position.x = Number(value);
      } else if (property === 'position_y') {
        seat.position.y = Number(value);
      } else {
        // Handle direct properties with type safety
        if (property === 'seat_number' && typeof value === 'string') {
          seat.seat_number = value;
        } else if (property === 'category' && typeof value === 'string') {
          seat.category = value;
        } else if (property === 'status' && typeof value === 'string') {
          seat.status = value;
        } else if (property === 'radius' && typeof value === 'number') {
          seat.radius = value;
        }
      }
    } else if (type === 'area' && areaIndex !== undefined && updatedSeatData.zones[zoneIndex].areas) {
      const area = updatedSeatData.zones[zoneIndex].areas![areaIndex];
      
      // Handle special cases for nested properties
      if (property === 'position_x') {
        area.position.x = Number(value);
      } else if (property === 'position_y') {
        area.position.y = Number(value);
      } else if (property === 'width' && area.rectangle) {
        area.rectangle.width = Number(value);
      } else if (property === 'height' && area.rectangle) {
        area.rectangle.height = Number(value);
      } else if (property === 'radius' && area.circle) {
        area.circle.radius = Number(value);
      } else if (property === 'radius_x' && area.ellipse?.radius) {
        area.ellipse.radius.x = Number(value);
      } else if (property === 'radius_y' && area.ellipse?.radius) {
        area.ellipse.radius.y = Number(value);
      } else if (property === 'text' && area.text && typeof value === 'string') {
          area.text.text = value;
        } else if (property === 'text_color' && area.text && typeof value === 'string') {
          area.text.color = value;
        } else if (property === 'text_size' && area.text && typeof value === 'number') {
          area.text.size = value;
      } else {
        // Handle direct properties with type safety
        if (property === 'shape' && typeof value === 'string') {
          area.shape = value as 'rectangle' | 'ellipse' | 'text' | 'circle' | 'polygon';
        } else if (property === 'color' && typeof value === 'string') {
          area.color = value;
        } else if (property === 'border_color' && typeof value === 'string') {
          area.border_color = value;
        } else if (property === 'rotation' && typeof value === 'number') {
          area.rotation = value;
        }
      }
    } else if (type === 'row' && rowIndex !== undefined) {
      const row = updatedSeatData.zones[zoneIndex].rows[rowIndex];
      
      // Handle special cases for nested properties
      if (property === 'position_x') {
        const oldX = row.position.x;
        const newX = Number(value);
        const deltaX = newX - oldX;
        
        // Update row position
        row.position.x = newX;
        
        // Update all seats in the row to maintain relative positions
        row.seats.forEach(seat => {
          seat.position.x = seat.position.x; // No change needed as seats are positioned relative to row
        });
      } else if (property === 'position_y') {
        const oldY = row.position.y;
        const newY = Number(value);
        const deltaY = newY - oldY;
        
        // Update row position
        row.position.y = newY;
        
        // Update all seats in the row to maintain relative positions
        row.seats.forEach(seat => {
          seat.position.y = seat.position.y; // No change needed as seats are positioned relative to row
        });
      } else if (property === 'row_number' && typeof value === 'string') {
          row.row_number = value;
        }
    }
    
    setSeatData(updatedSeatData);
    
    // Update selected object and properties
    if (type === 'row' && rowIndex !== undefined) {
      // For rows, we need to recreate the selected object since findObjectAtPosition doesn't handle rows
      const updatedRowObject: SelectedObject = {
        type: 'row',
        id: `row-${zoneIndex}-${rowIndex}`,
        data: updatedSeatData.zones[zoneIndex].rows[rowIndex],
        zoneIndex,
        rowIndex
      };
      
      setSelectedObject(updatedRowObject);
      setObjectProperties(getObjectProperties(updatedRowObject));
      
      // Update selected seats to highlight all seats in the row
      setSelectedSeats(findSeatsInRow(zoneIndex, rowIndex));
    } else {
      // For seats and areas, update the selected object with new data
      const updatedObjectData = selectedObject.data as Seat | Area;
      if ('position' in updatedObjectData) {
        const updatedObject = findObjectAtPosition(
          updatedObjectData.position.x + updatedSeatData.zones[zoneIndex].position.x,
          updatedObjectData.position.y + updatedSeatData.zones[zoneIndex].position.y
        );
        
        if (updatedObject) {
          setSelectedObject(updatedObject);
          setObjectProperties(getObjectProperties(updatedObject));
        }
      }
    }
  };
  
  // Handle property input change
  const handlePropertyChange = (property: string, value: string): void => {
    setObjectProperties(prev => ({
      ...prev,
      [property]: isNaN(Number(value)) ? value : Number(value)
    }));
  };
  
  // Apply property changes
  const applyPropertyChanges = (): void => {
    if (!objectProperties || Object.keys(objectProperties).length === 0) return;

    beginGesture();
    Object.entries(objectProperties).forEach(([property, value]) => {
      updateObjectProperty(property, value);
    });
  };
  
  // Toggle selection mode
  const toggleSelectionMode = (mode: SelectionMode): void => {
    setSelectionMode(mode);
    setSelectedSeats(new Set());
    setSelectedObject(null);
    setObjectProperties({});
  };
  
  // Handle keyboard shortcuts (ignored while typing in inputs)
  useEffect(() => {
    const isTyping = (e: KeyboardEvent): boolean => {
      const target = e.target as HTMLElement | null;
      if (!target) return false;
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === 's') {
        toggleSelectionMode('area');
      } else if (e.key === 'r') {
        toggleSelectionMode('row');
      } else if (e.key === 'a') {
        toggleSelectionMode('object');
      } else if (e.key === 'f') {
        fitToContent();
      } else if (e.key === '0') {
        resetZoom();
      } else if (e.key === '=' || e.key === '+') {
        zoomAtCenter(1.25);
      } else if (e.key === '-' || e.key === '_') {
        zoomAtCenter(0.8);
      }
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') setSpaceHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [fitToContent, resetZoom, zoomAtCenter, undo, redo]);
  
  // Handle key press events
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      updateCategoryName(editingCategory || '', editCategoryName);
    }
    if (e.key === 'Escape') {
      cancelEditingCategory();
    }
  };

  // Handle clipboard copy
  const handleClipboardCopy = async (): Promise<void> => {
    if (!seatData) return;
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(seatData, null, 2));
      showToast('JSON copied to clipboard');
    } catch (error) {
      showToast('Auto-copy failed — select all text manually and copy.', 'error');
    }
  };

  // Handle JSON download
  const handleJSONDownload = (): void => {
    if (!seatData) return;
    
    const jsonString = JSON.stringify(seatData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${seatData.name.replace(/\s+/g, '_').toLowerCase()}_seat_map.json`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Handle textarea focus
  const handleTextareaFocus = (e: React.FocusEvent<HTMLTextAreaElement>): void => {
    e.target.select();
  };

  const stats = getSeatStats();

  return (
    <div className="w-full h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Seat Map Editor</h1>
          <div className="flex items-center space-x-4">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              ref={fileInputRef}
              className="hidden"
            />
            {seatData && (
              <div className="flex items-center border rounded-lg overflow-hidden">
                <button
                  onClick={undo}
                  disabled={undoStackRef.current.length === 0}
                  className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
                  title="Undo (⌘Z)"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-gray-200" />
                <button
                  onClick={redo}
                  disabled={redoStackRef.current.length === 0}
                  className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
                  title="Redo (⇧⌘Z)"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
            )}
            {seatData && (
              <button
                onClick={() => setShowWizard(true)}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Numbering
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload JSON
            </button>
            {seatData && (
              <button
                onClick={showJSONOutput}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Copy className="w-4 h-4 mr-2" />
                Show JSON Output
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r p-4 overflow-y-auto">
          <div className="space-y-6">
            {/* Selection Mode Toggle */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Selection Mode</h3>
              <div className="flex space-x-2 mb-4">
                <button
                  onClick={() => toggleSelectionMode('area')}
                  className={`flex-1 py-2 px-2 rounded-lg ${selectionMode === 'area' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                  title="Area Selection: Select multiple seats by dragging (Shortcut: S)"
                >
                  <div className="flex flex-col items-center justify-center">
                    <Grid3X3 className="w-5 h-5 mb-1" />
                    <span className="text-xs">Area (S)</span>
                  </div>
                </button>
                <button
                  onClick={() => toggleSelectionMode('row')}
                  className={`flex-1 py-2 px-2 rounded-lg ${selectionMode === 'row' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                  title="Row Selection: Select and edit row properties (Shortcut: R)"
                >
                  <div className="flex flex-col items-center justify-center">
                    <Rows className="w-5 h-5 mb-1" />
                    <span className="text-xs">Row (R)</span>
                  </div>
                </button>
                <button
                  onClick={() => toggleSelectionMode('object')}
                  className={`flex-1 py-2 px-2 rounded-lg ${selectionMode === 'object' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                  title="Object Selection: Select individual seats or areas (Shortcut: A)"
                >
                  <div className="flex flex-col items-center justify-center">
                    <MousePointer className="w-5 h-5 mb-1" />
                    <span className="text-xs">Object (A)</span>
                  </div>
                </button>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Enable Movement</span>
                  <button
                    onClick={() => setIsMoveEnabled(prev => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                      isMoveEnabled ? 'bg-purple-600' : 'bg-gray-200'
                    }`}
                    title="Toggle direct object movement"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isMoveEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Object Properties */}
            {(selectionMode === 'object' || selectionMode === 'row') && selectedObject && (
              <div className="mb-4">
                <h3 className="text-lg font-semibold mb-3">Object Properties</h3>
                <div className="space-y-3 border rounded-lg p-3">
                  <div className="text-sm font-medium text-gray-700">
                    Type: {selectedObject.type.charAt(0).toUpperCase() + selectedObject.type.slice(1)}
                  </div>
                  
                  {Object.entries(objectProperties).map(([property, value]) => (
                    <div key={property} className="grid grid-cols-3 gap-2 items-center">
                      <label className="text-sm font-medium text-gray-700 col-span-1 capitalize">
                        {property.replace('_', ' ')}:
                      </label>
                      <input
                        type={typeof value === 'number' ? 'number' : 'text'}
                        value={value != null ? value.toString() : ''}
                        onChange={(e) => handlePropertyChange(property, e.target.value)}
                        className="col-span-2 px-2 py-1 text-sm border rounded"
                      />
                    </div>
                  ))}
                  
                  <button
                    onClick={applyPropertyChanges}
                    className="w-full mt-2 flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Apply Changes
                  </button>
                </div>
              </div>
            )}
            
            {/* Status Selection */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Status Update</h3>
              <select
                value={currentStatus}
                onChange={(e) => setCurrentStatus(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg"
              >
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
                <option value="void">Void</option>
                <option value="sold">Sold</option>
              </select>
              
              <div className="mt-3 space-y-2">
                <button
                  onClick={updateSelectedSeatsStatus}
                  disabled={selectedSeats.size === 0}
                  className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Update {selectedSeats.size} Selected Seat(s)
                </button>
                
                <button
                  onClick={resetSelection}
                  disabled={selectedSeats.size === 0}
                  className="w-full flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Clear Selection
                </button>
              </div>
            </div>

            {/* Category Selection */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Category Update</h3>
              <div className="w-full border border-gray-300 rounded-lg">
                <div className="p-2 bg-gray-50 border-b text-sm font-medium text-gray-700">
                  Select Category:
                </div>
                <div className="max-h-32 overflow-y-auto">
                  <div
                    className={`p-2 cursor-pointer hover:bg-blue-50 flex items-center space-x-2 ${
                      currentCategory === '' ? 'bg-blue-100' : ''
                    }`}
                    onClick={() => setCurrentCategory('')}
                  >
                    <div className="w-4 h-4 border border-gray-300 rounded-full bg-white" />
                    <span className="text-sm">No Category</span>
                  </div>
                  {seatData?.categories.map((category: Category, idx: number) => (
                    <div
                      key={idx}
                      className={`p-2 cursor-pointer hover:bg-blue-50 flex items-center space-x-2 ${
                        currentCategory === category.name ? 'bg-blue-100' : ''
                      }`}
                      onClick={() => setCurrentCategory(category.name)}
                    >
                      <div
                        className="w-4 h-4 rounded-full border border-gray-300"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="text-sm truncate">{category.label || category.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="mt-3 space-y-2">
                <button
                  onClick={updateSelectedSeatsCategory}
                  disabled={selectedSeats.size === 0 || !currentCategory}
                  className="w-full flex items-center justify-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Update {selectedSeats.size} Selected Seat(s) Category
                </button>
              </div>
            </div>

            {/* Legend */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Status Legend</h3>
              <div className="space-y-2">
                {Object.entries(statusConfig).map(([status, config]) => (
                  <div key={status} className="flex items-center space-x-3">
                    <div
                      className="w-6 h-6 rounded-full border-2"
                      style={{
                        backgroundColor: '#cccccc',
                        borderColor: config.outline,
                        borderWidth: config.width
                      }}
                    />
                    <span className="capitalize">{status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Statistics */}
            {seatData && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Seat Statistics</h3>
                <div className="space-y-2">
                  {Object.entries(stats).map(([status, count]) => (
                    <div key={status} className="flex justify-between">
                      <span className="capitalize">{status}:</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between font-bold">
                    <span>Total:</span>
                    <span>{Object.values(stats).reduce((a, b) => a + b, 0)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Categories */}
            {seatData?.categories && (
              <div>
                <h3 className="text-lg font-semibold mb-3">Categories</h3>
                <p className="text-xs text-gray-500 mb-2">
                  Display name is stored in the file and survives ticket-UUID changes. The UUID below it is what TipTip reads — swap it per show.
                </p>
                <div className="space-y-3">
                  {seatData.categories.map((category: Category, idx: number) => (
                    <div key={idx} className="p-2 border rounded-lg space-y-1.5">
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-5 h-5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <input
                          key={`${category.name}:${category.label ?? ''}`}
                          type="text"
                          defaultValue={category.label ?? ''}
                          placeholder="Display name (e.g. VIP)…"
                          onBlur={(e) => updateCategoryLabel(category.name, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="flex-1 min-w-0 px-2 py-1 text-sm font-medium border border-transparent hover:border-gray-300 focus:border-blue-400 rounded outline-none"
                        />
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {categoryCounts.get(category.name) || 0} seats
                        </span>
                      </div>
                      {editingCategory === category.name ? (
                        <div className="flex items-center space-x-2 pl-7">
                          <input
                            type="text"
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono border rounded"
                            autoFocus
                            onKeyPress={handleKeyPress}
                          />
                          <button
                            onClick={() => updateCategoryName(category.name, editCategoryName)}
                            className="p-1 text-green-600 hover:bg-green-100 rounded"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={cancelEditingCategory}
                            className="p-1 text-red-600 hover:bg-red-100 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between pl-7">
                          <span className="text-xs font-mono text-gray-500 break-all" title="Ticket UUID (category name read by TipTip)">
                            {category.name}
                          </span>
                          <button
                            onClick={() => startEditingCategory(category.name, category.name)}
                            className="p-1 text-blue-600 hover:bg-blue-100 rounded ml-2 flex-shrink-0"
                            title="Edit ticket UUID"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 p-4 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {seatData ? (
            <div className="bg-white rounded-lg shadow-sm border flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b">
                {editingTitle ? (
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 px-3 py-2 text-xl font-semibold border rounded"
                      autoFocus
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          if (editTitle.trim()) {
                            beginGesture();
                            setSeatData({...seatData, name: editTitle.trim()});
                            setEditingTitle(false);
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (editTitle.trim()) {
                          beginGesture();
                          setSeatData({...seatData, name: editTitle.trim()});
                          setEditingTitle(false);
                        }
                      }}
                      className="p-2 text-green-600 hover:bg-green-100 rounded"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingTitle(false);
                        setEditTitle(seatData.name);
                      }}
                      className="p-2 text-red-600 hover:bg-red-100 rounded"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-semibold">{seatData.name}</h2>
                    <button
                      onClick={() => {
                        setEditTitle(seatData.name);
                        setEditingTitle(true);
                      }}
                      className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <p className="text-gray-600 text-sm mt-1">
                  Drag to select seats &middot; Scroll to pan &middot; Pinch or &#8984;/Ctrl + scroll to zoom &middot; Space or middle-click + drag to pan
                </p>
              </div>
              <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden bg-gray-100 rounded-b-lg">
                <canvas
                  ref={canvasRef}
                  className={`absolute inset-0 ${
                    isPanning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : selectionMode === 'area' ? 'cursor-crosshair' : 'cursor-pointer'
                  }`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
                {/* Zoom toolbar */}
                <div className="absolute bottom-4 right-4 flex items-center bg-white border shadow-md rounded-lg overflow-hidden">
                  <button
                    onClick={() => zoomAtCenter(0.8)}
                    className="w-9 h-9 flex items-center justify-center hover:bg-gray-100"
                    title="Zoom out (-)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={resetZoom}
                    className="w-14 h-9 text-xs font-medium hover:bg-gray-100 tabular-nums"
                    title="Reset to 100% (0)"
                  >
                    {zoomPct}%
                  </button>
                  <button
                    onClick={() => zoomAtCenter(1.25)}
                    className="w-9 h-9 flex items-center justify-center hover:bg-gray-100"
                    title="Zoom in (+)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <div className="w-px h-5 bg-gray-200" />
                  <button
                    onClick={fitToContent}
                    className="w-9 h-9 flex items-center justify-center hover:bg-gray-100"
                    title="Fit to content (F)"
                  >
                    <Maximize className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-600 mb-2">
                  No Seat Map Loaded
                </h3>
                <p className="text-gray-500 mb-4">
                  Upload a JSON file to start editing seat statuses
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Upload JSON File
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* JSON Output Modal */}
      {showOutput && seatData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-6xl h-5/6 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <div>
                <h3 className="text-lg font-semibold">JSON Output</h3>
                <p className="text-sm text-gray-600">Select all text (Ctrl+A) and copy (Ctrl+C)</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleJSONDownload}
                  className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download JSON
                </button>
                <button
                  onClick={handleClipboardCopy}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All
                </button>
                <button
                  onClick={() => setShowOutput(false)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-hidden">
              <div className="h-full border rounded-lg overflow-hidden">
                <textarea
                  value={JSON.stringify(seatData, null, 2)}
                  readOnly
                  className="w-full h-full font-mono text-sm p-4 resize-none bg-gray-50 border-0 focus:outline-none"
                  style={{ 
                    minHeight: '100%',
                    fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace',
                    fontSize: '12px',
                    lineHeight: '1.4'
                  }}
                  onFocus={handleTextareaFocus}
                />
              </div>
            </div>
            <div className="p-4 border-t bg-gray-50">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>
                  Lines: {JSON.stringify(seatData, null, 2).split('\n').length} |
                  Characters: {JSON.stringify(seatData, null, 2).length.toLocaleString()}
                </span>
                <span className="text-blue-600 font-medium">
                  💡 Tip: Click in the text area and press Ctrl+A to select all, then Ctrl+C to copy
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Numbering & Labels wizard */}
      {showWizard && seatData && (
        <NumberingWizard
          seatData={seatData}
          selectedSeats={selectedSeats}
          onClose={() => setShowWizard(false)}
          onApply={(result: NumberingResult) => {
            beginGesture();
            setSeatData(result.next);
            setSelectedSeats(new Set());
            setShowWizard(false);
            showToast(
              `Applied numbering to ${result.rowsChanged} row(s), ${result.seatsChanged} seat(s).${result.warning ? ` ${result.warning}` : ''}`,
              result.warning ? 'info' : 'success'
            );
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-xl px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${
            toast.type === 'error' ? 'bg-red-600' : toast.type === 'info' ? 'bg-gray-800' : 'bg-green-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default SeatMapEditor;