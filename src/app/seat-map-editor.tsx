/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Copy, RotateCcw, Save, Edit2, Check, X } from 'lucide-react';

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
}

interface Area {
  shape: string;
  position: Position;
  color: string;
  border_color: string;
  rectangle?: Rectangle;
  text?: TextContent;
  rotation?: number;
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

const SeatMapEditor: React.FC = () => {
  const [seatData, setSeatData] = useState<SeatData | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<Position | null>(null);
  const [dragEnd, setDragEnd] = useState<Position | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>('available');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState<string>('');
  const [showOutput, setShowOutput] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setDragEnd({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!isDragging || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setDragEnd({ x, y });
  };

  const handleMouseUp = (): void => {
    if (isDragging && dragStart && dragEnd) {
      selectSeatsInArea();
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
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
      zone.rows.forEach((row: Row) => {
        row.seats.forEach((seat: Seat) => {
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

  // Draw the seat map
  const drawSeatMap = useCallback((): void => {
    if (!canvasRef.current || !seatData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw areas (background elements)
    seatData.zones.forEach((zone: Zone) => {
      if (zone.areas) {
        zone.areas.forEach((area: Area) => {
          ctx.save();
          
          if (area.shape === 'rectangle' && area.rectangle) {
            ctx.fillStyle = area.color;
            ctx.strokeStyle = area.border_color;
            ctx.lineWidth = 1;
            
            const x = area.position.x + zone.position.x;
            const y = area.position.y + zone.position.y;
            
            ctx.fillRect(x, y, area.rectangle.width, area.rectangle.height);
            ctx.strokeRect(x, y, area.rectangle.width, area.rectangle.height);
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
          if (selectedSeats.has(seat.seat_guid)) {
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
  }, [seatData, selectedSeats, isDragging, dragStart, dragEnd]);

  // Redraw when data changes
  useEffect(() => {
    drawSeatMap();
  }, [drawSeatMap]);

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
                  {seatData.categories.map((category: Category) => (
                    <div key={category.name} className="flex items-center space-x-3 p-2 border rounded-lg">
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
                <h2 className="text-xl font-semibold">{seatData.name}</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Click and drag to select multiple seats, then update their status
                </p>
              </div>
              <div className="p-4">
                <canvas
                  ref={canvasRef}
                  width={seatData.size.width}
                  height={seatData.size.height}
                  className="border border-gray-200 cursor-crosshair"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
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