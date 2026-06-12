/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, ZoomIn, ZoomOut, Maximize, History } from 'lucide-react';
import type { Position, Area, Seat, Row, Zone, Category, SeatData, Bounds, SelectedObject } from './model/types';
import NumberingWizard, { NumberingResult } from './panels/numbering-wizard';
import PropertiesPanel from './panels/properties-panel';
import Toolbar, { SelectionMode, ShapeKind } from './panels/toolbar';
import NewPlanModal from './panels/new-plan-modal';
import InsertModal from './panels/insert-modal';
import {
  estimateRowLayout,
  layoutRow,
  insertSeatBlock,
  deleteSeats,
  deleteRowAt,
  deleteAreaAt,
  offsetSeats,
  createBlankPlan,
  curveSeats,
  makeRectArea,
  makeEllipseArea,
  makeTextArea,
  addArea,
  InsertOptions,
} from './model/ops';
import { computeContentMetrics } from './model/metrics';
import { paintScene } from './engine/render';
import { findObjectAtPosition as hitTest } from './engine/hit-test';
import { useHistory } from './engine/useHistory';
import { useViewport } from './engine/useViewport';
import {
  areaToBox,
  handleWorldPositions,
  hitHandle,
  resizeBox,
  applyBoxToArea,
  isResizable,
  isUniform,
  handleCursor,
  type HandleId,
  type TransformBox,
} from './engine/transform';

interface Toast {
  message: string;
  type: 'success' | 'error' | 'info';
}

const SeatMapEditor: React.FC = () => {
  const [seatData, setSeatData] = useState<SeatData | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<Position | null>(null);
  const [dragEnd, setDragEnd] = useState<Position | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('area');
  const [selectedObject, setSelectedObject] = useState<SelectedObject | null>(null);
  const [objectProperties, setObjectProperties] = useState<Record<string, string | number>>({});
  const [isMoveEnabled, setIsMoveEnabled] = useState<boolean>(false);
  const [showInsertModal, setShowInsertModal] = useState<boolean>(false);
  const [isDraggingObject, setIsDraggingObject] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<Position | null>(null);
  // On-canvas resize gesture for a selected shape (engine/transform). The
  // original box is captured at mousedown so opposite-corner math is stable.
  const resizeRef = useRef<{ handle: HandleId; box: TransformBox; zoneIndex: number; areaIndex: number; uniform: boolean } | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);
  // Shape drawing (X5): an armed tool, plus the live drag rubber-band. The
  // draft is mirrored in a ref so the synchronous mousedown→move→up handlers
  // read it without waiting for a re-render; state drives the preview redraw.
  const [pendingShape, setPendingShape] = useState<ShapeKind | null>(null);
  const [shapeDraft, setShapeDraft] = useState<{ start: Position; end: Position } | null>(null);
  const shapeDraftRef = useRef<{ start: Position; end: Position } | null>(null);
  const pendingShapeRef = useRef<ShapeKind | null>(null);
  pendingShapeRef.current = pendingShape;
  // Multi-select: drag-moving a whole seat selection, and additive marquee (shift)
  const groupDragRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const marqueeAdditiveRef = useRef<boolean>(false);
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

  const seatDataRef = useRef<SeatData | null>(null);
  seatDataRef.current = seatData;

  // Undo / redo (engine/useHistory): snapshot stack behind beginGesture()
  const { beginGesture, undo, redo, reset: resetHistory, canUndo, canRedo } = useHistory(
    seatDataRef,
    setSeatData,
    () => {
      setSelectedSeats(new Set());
      setSelectedObject(null);
      setObjectProperties({});
    }
  );


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

  // Content bounding box + absolute seat positions (model/metrics)
  const contentMetrics = useMemo(() => computeContentMetrics(seatData), [seatData]);

  const panLastRef = useRef<Position | null>(null);
  const needsFitRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const hasSeatData = Boolean(seatData);

  // Viewport (engine/useViewport): zoom/pan/fit, HiDPI sizing, wheel, rAF loop
  const {
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
  } = useViewport(canvasRef, containerRef, contentMetrics.bounds, hasSeatData);

  // Fit the view once after a new file is loaded
  useEffect(() => {
    if (seatData && needsFitRef.current) {
      needsFitRef.current = false;
      fitToContent();
    }
  }, [seatData, fitToContent]);

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

  // Load a plan from JSON text — shared by file upload, drag-and-drop and
  // autosave restore
  const loadJSONText = useCallback((text: string): void => {
    try {
      const jsonData = JSON.parse(text);

      // Validate and fix data
      const { data: validatedData, fixedCount } = validateAndFixData(jsonData);

      if (fixedCount > 0) {
        showToast(`Fixed ${fixedCount} duplicate seat IDs in the uploaded file.`, 'info');
      }

      // Duplicate category names make colors and seat assignment ambiguous
      const names = (validatedData.categories || []).map((c: Category) => c.name);
      const dupes = names.filter((n: string, i: number) => names.indexOf(n) !== i);
      if (dupes.length > 0) {
        showToast(`Warning: ${dupes.length + 1} categories share the same name/UUID — edit one of them to a unique UUID, then reassign its seats.`, 'error');
      }

      resetHistory();
      needsFitRef.current = true;
      setSeatData(validatedData);
      setSelectedSeats(new Set());
      setSelectedObject(null);
      setObjectProperties({});
    } catch (error) {
      showToast('Invalid JSON file', 'error');
    }
  }, [showToast]);

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        if (e.target?.result) loadJSONText(e.target.result as string);
      };
      reader.readAsText(file);
      event.target.value = ''; // allow re-uploading the same file
    }
  };

  // ===== Autosave (N6): debounced working copy in localStorage =====
  const AUTOSAVE_KEY = 'seat-mapper:autosave';
  const [autosaveMeta, setAutosaveMeta] = useState<{ name: string; savedAt: number } | null>(null);

  // Offer to restore the last session on the landing screen
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data?.zones) setAutosaveMeta({ name: parsed.data.name || 'Untitled Plan', savedAt: parsed.savedAt });
      }
    } catch { /* corrupt autosave — ignore */ }
  }, []);

  // Persist every change, debounced so slider drags don't hammer localStorage
  useEffect(() => {
    if (!seatData) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), data: seatData }));
        setAutosaveMeta({ name: seatData.name, savedAt: Date.now() });
      } catch { /* quota exceeded — plan too large for localStorage */ }
    }, 800);
    return () => clearTimeout(t);
  }, [seatData]);

  const restoreAutosave = (): void => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      resetHistory();
      needsFitRef.current = true;
      setSeatData(parsed.data);
      setSelectedSeats(new Set());
      showToast(`Restored "${parsed.data.name || 'Untitled Plan'}" from the last session`);
    } catch {
      showToast('Could not restore the last session', 'error');
    }
  };

  // Drag-and-drop a JSON file anywhere on the window to open it
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => e.preventDefault();
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.json')) {
        showToast('Drop a .json seating file to open it', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        if (ev.target?.result) loadJSONText(ev.target.result as string);
      };
      reader.readAsText(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadJSONText, showToast]);

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

    // Armed insert tool: place the seat block at the click point
    if (pendingInsert) {
      beginGesture();
      const next = structuredClone(seatData);
      const added = insertSeatBlock(next, 0, { x, y }, {
        ...pendingInsert,
        category: seatData.categories[0]?.name || '',
      });
      setSeatData(next);
      setPendingInsert(null);
      const seatCount = added.reduce((a, r) => a + r.seats.length, 0);
      showToast(`Added ${added.length} row(s), ${seatCount} seat(s)`);
      return;
    }

    // Armed shape tool: text places immediately; rect/ellipse drag to size
    if (pendingShape) {
      if (pendingShape === 'text') {
        beginGesture();
        const next = structuredClone(seatData);
        const zone = next.zones[0];
        const area = makeTextArea(x - zone.position.x, y - zone.position.y);
        const idx = addArea(next, 0, area);
        setSeatData(next);
        setPendingShape(null);
        setSelectionMode('object');
        setSelectedObject({ type: 'area', id: area.uuid!, data: area, zoneIndex: 0, areaIndex: idx });
        setSelectedSeats(new Set());
        showToast('Text added — edit it in the panel');
      } else {
        const draft = { start: { x, y }, end: { x, y } };
        shapeDraftRef.current = draft;
        setShapeDraft(draft);
      }
      return;
    }

    // Grab a resize handle of the selected shape (takes priority over move/select)
    if (selectedObject?.type === 'area' && selectedObject.areaIndex !== undefined) {
      const zone = seatData.zones[selectedObject.zoneIndex];
      const area = zone.areas?.[selectedObject.areaIndex];
      if (area && isResizable(area)) {
        const box = areaToBox(area, zone.position.x, zone.position.y);
        if (box) {
          const tol = 9 / viewRef.current.scale;
          const handle = hitHandle(box, x, y, tol, isUniform(area));
          if (handle) {
            beginGesture();
            resizeRef.current = { handle, box, zoneIndex: selectedObject.zoneIndex, areaIndex: selectedObject.areaIndex, uniform: isUniform(area) };
            return;
          }
        }
      }
    }

    // Multi-seat selection: shift-click toggles a seat; pressing a seat that's
    // already part of a multi-selection drags the whole set. Works in area and
    // object modes (row mode keeps its row-select behavior).
    if (selectionMode !== 'row') {
      const hit = findObjectAtPosition(x, y);
      if (e.shiftKey && hit?.type === 'seat') {
        // Functional update so rapid shift-clicks accumulate correctly
        setSelectedSeats(prev => {
          const nextSel = new Set(prev);
          if (nextSel.has(hit.id)) nextSel.delete(hit.id);
          else nextSel.add(hit.id);
          selectedSeatsRef.current = nextSel;
          return nextSel;
        });
        setSelectedObject(null);
        setObjectProperties({});
        return;
      }
      if (hit?.type === 'seat' && selectedSeats.size > 1 && selectedSeats.has(hit.id)) {
        beginGesture();
        groupDragRef.current = { lastX: x, lastY: y };
        return;
      }
    }

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
      
      // If not dragging an object, start area selection. Shift = add to the
      // existing selection instead of replacing it.
      marqueeAdditiveRef.current = e.shiftKey;
      setIsDragging(true);
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setSelectedObject(null);
      if (!e.shiftKey) setSelectedSeats(new Set());
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

    // Drawing a shape: extend the rubber-band
    if (shapeDraftRef.current) {
      const draft = { start: shapeDraftRef.current.start, end: { x, y } };
      shapeDraftRef.current = draft;
      setShapeDraft(draft);
      requestRedraw();
      return;
    }

    // Active resize gesture: recompute the box from the captured original
    if (resizeRef.current) {
      const { handle, box, zoneIndex, areaIndex, uniform } = resizeRef.current;
      const next = structuredClone(seatData);
      const zone = next.zones[zoneIndex];
      const area = zone.areas?.[areaIndex];
      if (area) {
        const minSize = 4;
        const newBox = resizeBox(box, handle, x, y, uniform, minSize);
        applyBoxToArea(area, newBox, zone.position.x, zone.position.y);
        setSeatData(next);
        setSelectedObject({ type: 'area', id: selectedObject?.id ?? `area-${zoneIndex}-${areaIndex}`, data: area, zoneIndex, areaIndex });
      }
      return;
    }

    // Group drag: move the whole seat selection by the incremental delta
    if (groupDragRef.current) {
      const dx = x - groupDragRef.current.lastX;
      const dy = y - groupDragRef.current.lastY;
      groupDragRef.current = { lastX: x, lastY: y };
      const next = structuredClone(seatData);
      offsetSeats(next, selectedSeats, dx, dy);
      setSeatData(next);
      return;
    }

    // Hover feedback: show a resize cursor over a selected shape's handles
    if (!isDragging && !isDraggingObject && selectedObject?.type === 'area' && selectedObject.areaIndex !== undefined) {
      const zone = seatData.zones[selectedObject.zoneIndex];
      const area = zone.areas?.[selectedObject.areaIndex];
      const box = area && isResizable(area) ? areaToBox(area, zone.position.x, zone.position.y) : null;
      if (box && area) {
        const tol = 9 / viewRef.current.scale;
        const h = hitHandle(box, x, y, tol, isUniform(area));
        const cur = h ? handleCursor(h, box.rot) : null;
        if (cur !== hoverCursor) setHoverCursor(cur);
      } else if (hoverCursor) {
        setHoverCursor(null);
      }
    } else if (hoverCursor && !resizeRef.current) {
      setHoverCursor(null);
    }

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
    // Commit a drawn shape (rect / ellipse). A tiny drag uses a default size.
    if (shapeDraftRef.current && pendingShapeRef.current && seatData) {
      const pendingShape = pendingShapeRef.current;
      const { start, end } = shapeDraftRef.current;
      const minX = Math.min(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      let w = Math.abs(end.x - start.x);
      let h = Math.abs(end.y - start.y);
      if (w < 6 && h < 6) { w = 160; h = 90; } // click, not drag → default block
      beginGesture();
      const next = structuredClone(seatData);
      const zone = next.zones[0];
      const zx = zone.position.x;
      const zy = zone.position.y;
      let area;
      if (pendingShape === 'rectangle') {
        area = makeRectArea(minX - zx, minY - zy, w, h);
      } else {
        area = makeEllipseArea(minX + w / 2 - zx, minY + h / 2 - zy, w / 2, h / 2);
      }
      const idx = addArea(next, 0, area);
      setSeatData(next);
      shapeDraftRef.current = null;
      setShapeDraft(null);
      setPendingShape(null);
      setSelectionMode('object');
      setSelectedObject({ type: 'area', id: area.uuid!, data: area, zoneIndex: 0, areaIndex: idx });
      setSelectedSeats(new Set());
      showToast(`Added ${pendingShape}`);
      return;
    }
    if (resizeRef.current && selectedObject) {
      // Sync the panel's dimension fields to the resized shape
      setObjectProperties(getObjectProperties(selectedObject));
    }
    resizeRef.current = null;
    groupDragRef.current = null;
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

    // Additive marquee (shift) unions with the current selection
    const newSelectedSeats = marqueeAdditiveRef.current ? new Set(selectedSeats) : new Set<string>();

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

    marqueeAdditiveRef.current = false;
    setSelectedSeats(newSelectedSeats);
  };

  // Apply a status to the selected seats (from the properties panel)
  const applyStatusToSelection = (status: string): void => {
    if (!seatData || selectedSeats.size === 0) return;

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };

    updatedSeatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (selectedSeats.has(seat.seat_guid)) {
            seat.status = status.toUpperCase();
          }
        });
      });
    });

    setSeatData(updatedSeatData);
    showToast(`Set ${selectedSeats.size} seat(s) to ${status}`);
    setSelectedSeats(new Set());
  };

  // Assign the selected seats to a category (from its card in the Categories panel)
  const assignCategoryToSelection = (categoryIndex: number): void => {
    if (!seatData || selectedSeats.size === 0) return;
    const category = seatData.categories[categoryIndex];
    if (!category) return;

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };

    updatedSeatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (selectedSeats.has(seat.seat_guid)) {
            seat.category = category.name;
          }
        });
      });
    });

    setSeatData(updatedSeatData);
    showToast(`Assigned ${selectedSeats.size} seat(s) to ${category.label || category.name}`);
    setSelectedSeats(new Set());
  };

  // Scene painting (engine/render): areas + seats + row labels.
  // `cull` is a world-space rect: content outside it is skipped (used when
  // drawing per-frame at high zoom).
  const paintContent = useCallback((ctx: CanvasRenderingContext2D, cull: Bounds | null): void => {
    if (!seatData) return;
    paintScene(ctx, seatData, categoryMap, cull);
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

            // Resize handles for parametric shapes (rect / circle / ellipse)
            if (isResizable(area)) {
                const box = areaToBox(area, zone.position.x, zone.position.y);
                if (box) {
                    const hs = 4 / view.scale; // half handle size, screen-constant
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#fbbf24';
                    ctx.lineWidth = 1.5 / view.scale;
                    for (const h of handleWorldPositions(box, isUniform(area))) {
                        ctx.fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
                        ctx.strokeRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
                    }
                }
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

    // Draw the shape rubber-band while drawing a new rect/ellipse
    if (shapeDraft && pendingShape) {
      const { start, end } = shapeDraft;
      const rx = Math.min(start.x, end.x);
      const ry = Math.min(start.y, end.y);
      const rw = Math.abs(end.x - start.x);
      const rh = Math.abs(end.y - start.y);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.12)';
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 1.5 / view.scale;
      ctx.setLineDash([6 / view.scale, 4 / view.scale]);
      if (pendingShape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      }
      ctx.setLineDash([]);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [seatData, contentMetrics, paintContent, selectedSeats, isDragging, dragStart, dragEnd, selectedObject, shapeDraft, pendingShape]);

  // Keep the rAF loop pointed at the latest draw closure; redraw on state changes
  useEffect(() => {
    drawRef.current = draw;
    requestRedraw();
  }, [draw, requestRedraw]);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Update category name (= ticket UUID) by index
  const updateCategoryName = (categoryIndex: number, newName: string): void => {
    if (!seatData || !newName.trim()) return;
    const trimmed = newName.trim();
    if (!UUID_RE.test(trimmed)) {
      showToast('Category name must be a valid UUID (no spaces, correct format).', 'error');
      return;
    }
    const existing = seatData.categories[categoryIndex];
    if (!existing) return;
    if (existing.name === trimmed) return;

    // Names are the only link between seats and categories, so two categories
    // sharing one name makes colors and assignment ambiguous — block it.
    if (seatData.categories.some((c: Category, i: number) => i !== categoryIndex && c.name === trimmed)) {
      showToast('Another category already uses this name/UUID — pick a unique one.', 'error');
      return;
    }

    beginGesture();
    const updatedSeatData: SeatData = { ...seatData };
    const oldName = existing.name;

    // Update the name (ticket UUID) while preserving color, label and any
    // other fields — the alias must survive per-show UUID swaps
    updatedSeatData.categories[categoryIndex] = {
      ...existing,
      name: trimmed
    };

    // If the old name was duplicated across categories, seats can't be split
    // by name — leave them pointing at the remaining duplicate so renaming one
    // card is a safe way OUT of the duplicate state.
    const oldNameIsShared = updatedSeatData.categories.some(
      (c: Category, i: number) => i !== categoryIndex && c.name === oldName
    );
    if (oldNameIsShared) {
      showToast('This name was shared by two categories — seats stayed with the other one. Select and assign the seats that belong here.', 'info');
    } else {
      // Update all seats that reference this category
      updatedSeatData.zones.forEach((zone: Zone) => {
        zone.rows.forEach((row: Row) => {
          row.seats.forEach((seat: Seat) => {
            if (seat.category === oldName) {
              seat.category = trimmed;
            }
          });
        });
      });
    }

    setSeatData(updatedSeatData);
  };

  // Update category display alias (stored as categories[].label inside the
  // JSON — TipTip's importer tolerates the extra field, so the readable name
  // survives the per-show ticket-UUID swap of `name`)
  const updateCategoryLabel = (categoryIndex: number, label: string): void => {
    if (!seatData || !seatData.categories[categoryIndex]) return;
    const trimmed = label.trim();
    if ((seatData.categories[categoryIndex].label || '') === trimmed) return;
    beginGesture();
    setSeatData({
      ...seatData,
      categories: seatData.categories.map((c: Category, i: number) =>
        i === categoryIndex ? { ...c, label: trimmed || undefined } : c
      ),
    });
  };

  const updateCategoryColor = (categoryIndex: number, color: string): void => {
    if (!seatData || !seatData.categories[categoryIndex]) return;
    if (seatData.categories[categoryIndex].color === color) return;
    beginGesture();
    setSeatData({
      ...seatData,
      categories: seatData.categories.map((c: Category, i: number) =>
        i === categoryIndex ? { ...c, color } : c
      ),
    });
  };

  const CATEGORY_PALETTE = ['#E61D54', '#1D8EF6', '#3BAD77', '#F9A62A', '#9B59B6', '#16A2B8', '#E67E22', '#7F8C8D'];

  const addCategory = (): void => {
    if (!seatData) return;
    beginGesture();
    const n = seatData.categories.length;
    setSeatData({
      ...seatData,
      categories: [
        ...seatData.categories,
        { name: crypto.randomUUID(), color: CATEGORY_PALETTE[n % CATEGORY_PALETTE.length], label: `CAT ${n + 1}` },
      ],
    });
    showToast('Category added — set its display name and swap in the real ticket UUID', 'info');
  };

  const deleteCategory = (categoryIndex: number): void => {
    if (!seatData) return;
    const category = seatData.categories[categoryIndex];
    if (!category) return;
    const inUse = categoryCounts.get(category.name) || 0;
    if (inUse > 0) {
      showToast(`${inUse} seat(s) still use this category — reassign them first.`, 'error');
      return;
    }
    beginGesture();
    setSeatData({
      ...seatData,
      categories: seatData.categories.filter((_: Category, i: number) => i !== categoryIndex),
    });
    showToast(`Deleted category "${category.label || category.name.slice(0, 8) + '…'}"`);
  };

  // Click a category's seat count to select all its seats (N4: highlight +
  // quick bulk reassign)
  const selectCategorySeats = (categoryIndex: number): void => {
    if (!seatData) return;
    const category = seatData.categories[categoryIndex];
    if (!category) return;
    const guids = new Set<string>();
    seatData.zones.forEach((zone: Zone) => {
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
          if (seat.category === category.name) guids.add(seat.seat_guid);
        });
      });
    });
    if (guids.size === 0) {
      showToast('No seats use this category yet', 'info');
      return;
    }
    setSelectedObject(null);
    setObjectProperties({});
    setSelectedSeats(guids);
    showToast(`Selected ${guids.size} seat(s) in ${category.label || 'this category'}`);
  };

  // Clear the whole selection
  const clearSelection = (): void => {
    setSelectedSeats(new Set());
    setSelectedObject(null);
    setObjectProperties({});
  };

  // Rename the plan (from the properties panel)
  const commitPlanName = (name: string): void => {
    if (!seatData || !name.trim() || name.trim() === seatData.name) return;
    beginGesture();
    setSeatData({ ...seatData, name: name.trim() });
  };

  // Hit-testing (engine/hit-test); cycles overlapping objects on repeat clicks
  const findObjectAtPosition = (x: number, y: number): SelectedObject | null => {
    if (!seatData) return null;
    return hitTest(seatData, x, y, selectedObject);
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
  
  // ===== Editor actions: properties panel, insert tools, delete, nudge =====

  // Selection mirrored in refs so stable callbacks (keyboard) see fresh state
  const selectedObjectRef = useRef<SelectedObject | null>(null);
  selectedObjectRef.current = selectedObject;
  const selectedSeatsRef = useRef<Set<string>>(selectedSeats);
  selectedSeatsRef.current = selectedSeats;

  const refreshRowSelection = (next: SeatData, zoneIndex: number, rowIndex: number): void => {
    const row = next.zones[zoneIndex].rows[rowIndex];
    setSelectedObject({ type: 'row', id: `row-${zoneIndex}-${rowIndex}`, data: row, zoneIndex, rowIndex });
    setSelectedSeats(new Set(row.seats.map((s: Seat) => s.seat_guid)));
  };

  // Seat/area fields from the properties panel: one gesture per commit
  const commitObjectProp = (prop: string, value: string | number): void => {
    beginGesture();
    updateObjectProperty(prop, value);
  };

  const commitRowField = (field: 'row_number' | 'row_number_position', value: string): void => {
    if (!seatData || selectedObject?.type !== 'row' || selectedObject.rowIndex === undefined) return;
    beginGesture();
    const next = structuredClone(seatData);
    const row = next.zones[selectedObject.zoneIndex].rows[selectedObject.rowIndex];
    if (field === 'row_number') {
      row.row_number = value;
    } else if (value) {
      row.row_number_position = value;
    } else {
      delete row.row_number_position;
    }
    setSeatData(next);
    refreshRowSelection(next, selectedObject.zoneIndex, selectedObject.rowIndex);
  };

  // Spacing / curve. gesture=false during slider drags: the gesture was opened
  // on pointer-down, so the whole drag is one undo step with live preview.
  const rowLayoutChange = (spacing: number, sagitta: number, gesture: boolean): void => {
    if (!seatData || selectedObject?.type !== 'row' || selectedObject.rowIndex === undefined) return;
    if (gesture) beginGesture();
    const next = structuredClone(seatData);
    const row = next.zones[selectedObject.zoneIndex].rows[selectedObject.rowIndex];
    layoutRow(row, spacing, sagitta);
    setSeatData(next);
    refreshRowSelection(next, selectedObject.zoneIndex, selectedObject.rowIndex);
  };

  const rowBulk = (field: 'radius' | 'category', value: number | string): void => {
    if (!seatData || selectedObject?.type !== 'row' || selectedObject.rowIndex === undefined) return;
    beginGesture();
    const next = structuredClone(seatData);
    const row = next.zones[selectedObject.zoneIndex].rows[selectedObject.rowIndex];
    row.seats.forEach((s: Seat) => {
      if (field === 'radius') s.radius = value as number;
      else s.category = value as string;
    });
    setSeatData(next);
    refreshRowSelection(next, selectedObject.zoneIndex, selectedObject.rowIndex);
  };

  // Curve an arbitrary seat selection along a circular arc (works across rows
  // and physical gaps — treats the selected seats as a flat point set)
  const selectionBendChange = (sagitta: number, gesture: boolean): void => {
    if (!seatData || selectedSeats.size < 2) return;
    if (gesture) beginGesture();
    const next = structuredClone(seatData);
    curveSeats(next, selectedSeats, sagitta);
    setSeatData(next);
  };

  const selectedRowLayout = useMemo(() => {
    if (selectedObject?.type === 'row') return estimateRowLayout(selectedObject.data as Row);
    return null;
  }, [selectedObject, seatData]);

  const deleteSelection = useCallback((): void => {
    const data = seatDataRef.current;
    if (!data) return;
    const sel = selectedObjectRef.current;
    const seats = selectedSeatsRef.current;

    if (sel?.type === 'row' && sel.rowIndex !== undefined) {
      beginGesture();
      const next = structuredClone(data);
      const count = deleteRowAt(next, sel.zoneIndex, sel.rowIndex);
      setSeatData(next);
      showToast(`Deleted row (${count} seats)`);
    } else if (sel?.type === 'area' && sel.areaIndex !== undefined) {
      beginGesture();
      const next = structuredClone(data);
      deleteAreaAt(next, sel.zoneIndex, sel.areaIndex);
      setSeatData(next);
      showToast('Deleted shape');
    } else if (sel?.type === 'seat') {
      beginGesture();
      const next = structuredClone(data);
      deleteSeats(next, new Set([sel.id]));
      setSeatData(next);
      showToast('Deleted seat');
    } else if (seats.size > 0) {
      beginGesture();
      const next = structuredClone(data);
      const removed = deleteSeats(next, seats);
      setSeatData(next);
      showToast(`Deleted ${removed} seat(s)`);
    } else {
      return;
    }
    setSelectedObject(null);
    setSelectedSeats(new Set());
    setObjectProperties({});
  }, [beginGesture, showToast]);

  // Arrow-key nudge; rapid presses share one undo step
  const nudgeGestureAtRef = useRef<number>(0);
  const nudgeSelection = useCallback((dx: number, dy: number): void => {
    const data = seatDataRef.current;
    if (!data) return;
    const sel = selectedObjectRef.current;
    const seats = selectedSeatsRef.current;
    if (!sel && seats.size === 0) return;

    const now = Date.now();
    if (now - nudgeGestureAtRef.current > 800) beginGesture();
    nudgeGestureAtRef.current = now;

    const next = structuredClone(data);
    if (sel?.type === 'row' && sel.rowIndex !== undefined) {
      const row = next.zones[sel.zoneIndex].rows[sel.rowIndex];
      row.position.x += dx;
      row.position.y += dy;
      setSeatData(next);
      setSelectedObject({ ...sel, data: row });
    } else if (sel?.type === 'area' && sel.areaIndex !== undefined && next.zones[sel.zoneIndex].areas) {
      const area = next.zones[sel.zoneIndex].areas![sel.areaIndex];
      area.position.x += dx;
      area.position.y += dy;
      setSeatData(next);
      setSelectedObject({ ...sel, data: area });
    } else if (sel?.type === 'seat' && sel.rowIndex !== undefined && sel.seatIndex !== undefined) {
      const seat = next.zones[sel.zoneIndex].rows[sel.rowIndex].seats[sel.seatIndex];
      seat.position.x += dx;
      seat.position.y += dy;
      setSeatData(next);
      setSelectedObject({ ...sel, data: seat });
    } else if (seats.size > 0) {
      offsetSeats(next, seats, dx, dy);
      setSeatData(next);
    }
  }, [beginGesture]);

  // Insert tools: arm with options, then click the canvas to place
  const [pendingInsert, setPendingInsert] = useState<(InsertOptions & { kind: 'row' | 'grid' }) | null>(null);
  const [insertForm, setInsertForm] = useState({ rows: 5, seatsPerRow: 10, spacing: 28, rowSpacing: 28, radius: 10 });

  // New plan: modal with name + initial grid size (rows can be 0 for an empty
  // plan). Available from the landing screen AND the toolbar while editing.
  const [showNewPlanModal, setShowNewPlanModal] = useState<boolean>(false);
  const [newPlanForm, setNewPlanForm] = useState({ name: 'Untitled Plan', rows: 10, seatsPerRow: 12, spacing: 28, rowSpacing: 28, radius: 10 });

  const createNewPlan = (): void => {
    const data = createBlankPlan(newPlanForm.name.trim() || 'Untitled Plan');
    let seatCount = 0;
    if (newPlanForm.rows > 0 && newPlanForm.seatsPerRow > 0) {
      const added = insertSeatBlock(data, 0, { x: 120, y: 120 }, {
        rows: newPlanForm.rows,
        seatsPerRow: newPlanForm.seatsPerRow,
        spacing: newPlanForm.spacing,
        rowSpacing: newPlanForm.rowSpacing,
        radius: newPlanForm.radius,
        category: data.categories[0]?.name || '',
      });
      seatCount = added.reduce((a, r) => a + r.seats.length, 0);
    }
    resetHistory();
    needsFitRef.current = true;
    setSeatData(data);
    setSelectedSeats(new Set());
    setSelectedObject(null);
    setObjectProperties({});
    setShowNewPlanModal(false);
    showToast(
      seatCount > 0
        ? `Created "${data.name}" — ${newPlanForm.rows} rows, ${seatCount} seats. Run Numbering next.`
        : `Created empty plan "${data.name}" — use Insert to add seats`,
      'success'
    );
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
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      } else if (e.key === 'Escape') {
        setPendingInsert(null);
        setPendingShape(null);
        shapeDraftRef.current = null;
        setShapeDraft(null);
        setSelectedSeats(new Set());
        setSelectedObject(null);
        setObjectProperties({});
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
  }, [fitToContent, resetZoom, zoomAtCenter, undo, redo, deleteSelection, nudgeSelection]);
  
  // Export = download the JSON file directly (no preview modal)
  const handleJSONDownload = (): void => {
    if (!seatData) return;

    const jsonString = JSON.stringify(seatData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const filename = `${seatData.name.replace(/\s+/g, '_').toLowerCase()}_seat_map.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    showToast(`Downloaded ${filename}`);
  };

  return (
    <div className="w-full h-screen bg-gray-50 flex flex-col">
      <input
        type="file"
        accept=".json"
        onChange={handleFileUpload}
        ref={fileInputRef}
        className="hidden"
      />
      <Toolbar
        hasData={Boolean(seatData)}
        selectionMode={selectionMode}
        onSelectMode={toggleSelectionMode}
        isMoveEnabled={isMoveEnabled}
        onToggleMove={() => setIsMoveEnabled(prev => !prev)}
        onInsert={() => setShowInsertModal(true)}
        onShape={(shape) => { setPendingShape(prev => prev === shape ? null : shape); setPendingInsert(null); }}
        activeShape={pendingShape}
        onWizard={() => setShowWizard(true)}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onNewPlan={() => setShowNewPlanModal(true)}
        onUploadClick={() => fileInputRef.current?.click()}
        onExport={handleJSONDownload}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 p-4 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {seatData ? (
            <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden bg-gray-100">
                <canvas
                  ref={canvasRef}
                  className={`absolute inset-0 ${
                    pendingInsert || pendingShape ? 'cursor-crosshair' : isPanning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : selectionMode === 'area' ? 'cursor-crosshair' : 'cursor-pointer'
                  }`}
                  style={hoverCursor ? { cursor: hoverCursor } : undefined}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
                {pendingInsert && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-full shadow-md pointer-events-none">
                    Click on the canvas to place · Esc to cancel
                  </div>
                )}
                {pendingShape && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-full shadow-md pointer-events-none">
                    {pendingShape === 'text' ? 'Click to place text' : `Drag to draw a ${pendingShape}`} · Esc to cancel
                  </div>
                )}
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
                <div className="flex items-center justify-center space-x-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Upload JSON File
                  </button>
                  <button
                    onClick={() => setShowNewPlanModal(true)}
                    className="px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    New Plan
                  </button>
                </div>
                {autosaveMeta && (
                  <button
                    onClick={restoreAutosave}
                    className="mt-4 inline-flex items-center text-sm text-blue-600 hover:underline"
                  >
                    <History className="w-4 h-4 mr-1.5" />
                    Restore last session — “{autosaveMeta.name}” ({new Date(autosaveMeta.savedAt).toLocaleString()})
                  </button>
                )}
                <p className="mt-3 text-xs text-gray-400">…or drag &amp; drop a .json file anywhere</p>
              </div>
            </div>
          )}
        </div>

        {/* Contextual properties panel (pretix-style) */}
        {seatData && (
          <PropertiesPanel
            seatData={seatData}
            selectedObject={selectedObject}
            selectedSeats={selectedSeats}
            rowLayout={selectedRowLayout}
            categoryCounts={categoryCounts}
            callbacks={{
              commitObjectProp,
              commitRowField,
              rowLayoutStart: beginGesture,
              rowLayoutChange,
              rowBulk,
              deleteSelection,
              commitPlanName,
              applyStatus: applyStatusToSelection,
              clearSelection,
              assignCategory: assignCategoryToSelection,
              updateCategoryLabel,
              updateCategoryName,
              updateCategoryColor,
              addCategory,
              deleteCategory,
              selectCategorySeats,
              selectionBendStart: beginGesture,
              selectionBendChange,
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="bg-white border-t px-3 py-1 text-xs text-gray-500 flex items-center justify-between flex-shrink-0">
        <span>
          {pendingInsert
            ? 'Click on the canvas to place the seat block · Esc to cancel'
            : selectionMode === 'area'
            ? 'Drag to select seats · Shift-click adds/removes · Shift-drag extends · drag a selected seat to move the group'
            : selectionMode === 'row'
            ? 'Click a seat to select its row'
            : 'Click a seat or shape to select it · Shift-click seats for multi-select'}
          {' · Scroll to pan · Pinch or ⌘/Ctrl + scroll to zoom · Space or middle-click + drag to pan'}
        </span>
        <span className="hidden md:inline">S / R / A modes · F fit · 0 reset zoom · ⌘Z undo</span>
      </div>

      {/* Modals */}
      {showInsertModal && seatData && (
        <InsertModal
          form={insertForm}
          setForm={setInsertForm}
          onCancel={() => setShowInsertModal(false)}
          onPlace={() => {
            setPendingInsert({ ...insertForm, kind: 'grid', category: '' });
            setShowInsertModal(false);
          }}
        />
      )}

      {showNewPlanModal && (
        <NewPlanModal
          form={newPlanForm}
          setForm={setNewPlanForm}
          replacesCurrent={Boolean(seatData)}
          onCancel={() => setShowNewPlanModal(false)}
          onCreate={createNewPlan}
        />
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