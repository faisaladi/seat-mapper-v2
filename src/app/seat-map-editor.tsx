/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Copy, RotateCcw, Save, Edit2, Check, X, Download, MousePointer, Grid3X3, Rows, ZoomIn, ZoomOut } from 'lucide-react';

// Type definitions
interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface Rectangle {
  width: number;
  height: number;
}

interface TextContent {
  text: string;
  color: string;
  size: number;
  position?: Position;
}

interface Radius {
  x: number;
  y: number;
}

interface Ellipse {
  radius: Radius;
}

interface Circle {
  radius: number;
}

interface Polygon {
  points: Position[];
}

interface Area {
  uuid?: string;
  shape: string;
  position: Position;
  color: string;
  border_color: string;
  rectangle?: Rectangle;
  text?: TextContent;
  rotation?: number;
  ellipse?: Ellipse;
  circle?: Circle;
  polygon?: Polygon;
}

interface Seat {
  seat_guid: string;
  seat_number: string;
  position: Position;
  category: string;
  status?: string;
  radius?: number;
}

interface Row {
  position: Position;
  seats: Seat[];
  row_number?: string;
}

interface Zone {
  position: Position;
  rows: Row[];
  areas?: Area[];
}

interface Category {
  name: string;
  color: string;
}

interface SeatData {
  name: string;
  size: Size;
  zones: Zone[];
  categories: Category[];
}

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

  // Zoom state and controls
  const [zoom, setZoom] = useState<number>(1);
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.1;

  const zoomIn = (): void => {
    setZoom((prev) => Math.min(MAX_ZOOM, parseFloat((prev + ZOOM_STEP).toFixed(2))));
  };

  const zoomOut = (): void => {
    setZoom((prev) => Math.max(MIN_ZOOM, parseFloat((prev - ZOOM_STEP).toFixed(2))));
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    if (!seatData) return;
    // Only handle pinch-zoom (typically sends wheel with ctrlKey)
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else if (e.deltaY > 0) {
      zoomOut();
    }
  };

  // Status configurations
  const statusConfig: Record<string, StatusConfig> = {
    'available': { outline: '#22c55e', width: 2 },
    'unavailable': { outline: '#ef4444', width: 2 },
    'void': { outline: '#6b7280', width: 2 },
    'sold': { outline: '#000000', width: 3 }
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
          setSeatData(jsonData);
          setSelectedSeats(new Set());
        } catch (error) {
          alert('Invalid JSON file');
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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!canvasRef.current || !seatData) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
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
    if (!canvasRef.current || !seatData) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
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

  // Draw the seat map
  const drawSeatMap = useCallback((): void => {
    if (!canvasRef.current || !seatData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Reset transform and clear canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Apply zoom scaling
    ctx.save();
    ctx.scale(zoom, zoom);

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
            
            // Highlight selected area
            if (selectedObject?.type === 'area' && 
                selectedObject.id === (area.uuid || `area-${zoneIndex}-${areaIndex}`)) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 3;
              ctx.strokeRect(x - 2, y - 2, area.rectangle.width + 4, area.rectangle.height + 4);
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
            
            // Highlight selected area
            if (selectedObject?.type === 'area' && 
                selectedObject.id === (area.uuid || `area-${zoneIndex}-${areaIndex}`)) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(centerX, centerY, radius + 2, 0, 2 * Math.PI);
              ctx.stroke();
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
            
            // Highlight selected area
            if (selectedObject?.type === 'area' && 
                selectedObject.id === (area.uuid || `area-${zoneIndex}-${areaIndex}`)) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.ellipse(centerX, centerY, radiusX + 2, radiusY + 2, area.rotation ? (area.rotation * Math.PI) / 180 : 0, 0, 2 * Math.PI);
              ctx.stroke();
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

            // Highlight selected area
            if (selectedObject?.type === 'area' && 
                selectedObject.id === (area.uuid || `area-${zoneIndex}-${areaIndex}`)) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
              }
              ctx.closePath();
              ctx.stroke();
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
          const category = seatData.categories.find((cat: Category) => cat.name === seat.category);
          const seatX = seat.position.x + zone.position.x + row.position.x;
          const seatY = seat.position.y + zone.position.y + row.position.y;
          const radius = seat.radius || 8;

          // Draw seat circle
          ctx.beginPath();
          ctx.arc(seatX, seatY, radius, 0, 2 * Math.PI);
          ctx.fillStyle = category ? category.color : '#cccccc';
          ctx.fill();

          // Draw status outline
          const status = seat.status ? seat.status.toLowerCase() : 'available';
          const statusStyle = statusConfig[status] || statusConfig['available'];
          ctx.strokeStyle = statusStyle.outline;
          ctx.lineWidth = statusStyle.width;
          ctx.stroke();

          // Highlight selected seats
          if (selectedSeats.has(seat.seat_guid) || 
              (selectedObject?.type === 'seat' && selectedObject.id === seat.seat_guid)) {
            ctx.beginPath();
            ctx.arc(seatX, seatY, radius + 3, 0, 2 * Math.PI);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          // Draw seat number
          ctx.fillStyle = '#000000';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(seat.seat_number, seatX, seatY + 3);
        });
      });
    });

    // Draw selection rectangle
    if (isDragging && dragStart && dragEnd) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        Math.min(dragStart.x, dragEnd.x),
        Math.min(dragStart.y, dragEnd.y),
        Math.abs(dragEnd.x - dragStart.x),
        Math.abs(dragEnd.y - dragStart.y)
      );
      ctx.setLineDash([]);
    }
    // Restore after drawing
    ctx.restore();
  }, [seatData, selectedSeats, isDragging, dragStart, dragEnd, selectedObject, zoom]);

  // Redraw when data changes
  useEffect(() => {
    drawSeatMap();
  }, [drawSeatMap]);

  // Initialize currentCategory when seatData loads
  useEffect(() => {
    if (seatData && seatData.categories && seatData.categories.length > 0 && !currentCategory) {
      setCurrentCategory(seatData.categories[0].name);
    }
  }, [seatData, currentCategory]);

  // Update category name
  const updateCategoryName = (categoryId: string, newName: string): void => {
    if (!seatData || !newName.trim()) return;

    const updatedSeatData: SeatData = { ...seatData };
    const categoryIndex = updatedSeatData.categories.findIndex((cat: Category) => cat.name === categoryId);
    
    if (categoryIndex !== -1) {
      const oldName = updatedSeatData.categories[categoryIndex].name;
      const categoryColor = updatedSeatData.categories[categoryIndex].color;
      
      // Update category name while preserving color
      updatedSeatData.categories[categoryIndex] = {
        name: newName.trim(),
        color: categoryColor
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
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 's') {
        toggleSelectionMode('area');
      } else if (e.key === 'r') {
        toggleSelectionMode('row');
      } else if (e.key === 'a') {
        toggleSelectionMode('object');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
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
      alert('✅ JSON successfully copied to clipboard!');
    } catch (error) {
      alert('❌ Auto-copy failed. Please select all text manually and copy.');
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
                      <span className="text-sm truncate">{category.name}</span>
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
                <div className="space-y-3">
                  {seatData.categories.map((category: Category, idx: number) => (
                    <div key={idx} className="flex items-center space-x-3 p-2 border rounded-lg">
                      <div
                        className="w-6 h-6 rounded-full flex-shrink-0"
                        style={{ backgroundColor: category.color }}
                      />
                      {editingCategory === category.name ? (
                        <div className="flex-1 flex items-center space-x-2">
                          <input
                            type="text"
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                            className="flex-1 px-2 py-1 text-sm border rounded"
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
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-sm font-mono break-all">{category.name}</span>
                          <button
                            onClick={() => startEditingCategory(category.name, category.name)}
                            className="p-1 text-blue-600 hover:bg-blue-100 rounded ml-2"
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
        <div className="flex-1 p-4 overflow-auto">
          {seatData ? (
            <div className="bg-white rounded-lg shadow-sm border">
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
                            setSeatData({...seatData, name: editTitle.trim()});
                            setEditingTitle(false);
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (editTitle.trim()) {
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
                  Click and drag to select multiple seats, then update their status
                </p>
              </div>
              <div className="p-4 relative overflow-auto max-h-[calc(100vh-200px)]">
                <div className="inline-block">
                  <canvas
                    ref={canvasRef}
                    width={seatData.size.width}
                    height={seatData.size.height}
                    className={`border border-gray-200 ${selectionMode === 'area' ? 'cursor-crosshair' : 'cursor-pointer'}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                  />
                </div>
                {/* Floating Zoom Controls anchored to scroll container (sticky) */}
                <div className="sticky left-4 bottom-4 flex flex-col items-start space-y-2 z-20 pointer-events-none">
                  <button
                    onClick={zoomOut}
                    className="inline-flex items-center justify-center w-10 h-10 bg-white border shadow hover:bg-gray-100 rounded-sm pointer-events-auto"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <button
                    onClick={zoomIn}
                    className="inline-flex items-center justify-center w-10 h-10 bg-white border shadow hover:bg-gray-100 rounded-sm pointer-events-auto"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-5 h-5" />
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
    </div>
  );
};

export default SeatMapEditor;