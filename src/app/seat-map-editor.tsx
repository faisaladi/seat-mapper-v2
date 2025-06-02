'use client';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Copy, RotateCcw, Save, Edit2, Check, X } from 'lucide-react';

const SeatMapEditor = () => {
  const [seatData, setSeatData] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [currentStatus, setCurrentStatus] = useState('available');
  const [editingCategory, setEditingCategory] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [showOutput, setShowOutput] = useState(false);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Status configurations
  const statusConfig = {
    'available': { outline: '#22c55e', width: 2 },
    'unavailable': { outline: '#ef4444', width: 2 },
    'void': { outline: '#6b7280', width: 2 },
    'sold': { outline: '#000000', width: 3 }
  };

  // Handle file upload
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonData = JSON.parse(e.target.result);
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
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setDragEnd({ x, y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setDragEnd({ x, y });
  };

  const handleMouseUp = () => {
    if (isDragging && dragStart && dragEnd) {
      selectSeatsInArea();
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  };

  // Select seats within drag area
  const selectSeatsInArea = () => {
    if (!seatData || !dragStart || !dragEnd) return;

    const minX = Math.min(dragStart.x, dragEnd.x);
    const maxX = Math.max(dragStart.x, dragEnd.x);
    const minY = Math.min(dragStart.y, dragEnd.y);
    const maxY = Math.max(dragStart.y, dragEnd.y);

    const newSelectedSeats = new Set();

    seatData.zones.forEach(zone => {
      zone.rows.forEach(row => {
        row.seats.forEach(seat => {
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
  const updateSelectedSeatsStatus = () => {
    if (!seatData || selectedSeats.size === 0) return;

    const updatedSeatData = { ...seatData };
    
    updatedSeatData.zones.forEach(zone => {
      zone.rows.forEach(row => {
        row.seats.forEach(seat => {
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
  const drawSeatMap = useCallback(() => {
    if (!canvasRef.current || !seatData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw areas (background elements)
    seatData.zones.forEach(zone => {
      if (zone.areas) {
        zone.areas.forEach(area => {
          ctx.save();
          
          if (area.shape === 'rectangle') {
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
    seatData.zones.forEach(zone => {
      zone.rows.forEach(row => {
        row.seats.forEach(seat => {
          const category = seatData.categories.find(cat => cat.name === seat.category);
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
  const updateCategoryName = (categoryId, newName) => {
    if (!seatData || !newName.trim()) return;

    const updatedSeatData = { ...seatData };
    const categoryIndex = updatedSeatData.categories.findIndex(cat => cat.name === categoryId);
    
    if (categoryIndex !== -1) {
      const oldName = updatedSeatData.categories[categoryIndex].name;
      const categoryColor = updatedSeatData.categories[categoryIndex].color;
      
      // Update category name while preserving color
      updatedSeatData.categories[categoryIndex] = {
        name: newName.trim(),
        color: categoryColor
      };
      
      // Update all seats that reference this category
      updatedSeatData.zones.forEach(zone => {
        zone.rows.forEach(row => {
          row.seats.forEach(seat => {
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
  const startEditingCategory = (categoryId, currentName) => {
    setEditingCategory(categoryId);
    setEditCategoryName(currentName);
  };

  // Cancel editing category
  const cancelEditingCategory = () => {
    setEditingCategory(null);
    setEditCategoryName('');
  };

  // Copy JSON to clipboard
  const copyToClipboard = async () => {
    if (!seatData) return;

    const jsonOutput = JSON.stringify(seatData, null, 2);
    
    try {
      await navigator.clipboard.writeText(jsonOutput);
      alert('✅ JSON successfully copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback: show in modal for manual copy
      setShowOutput(true);
      alert('❌ Auto-copy failed. Opening modal for manual copy.');
    }
  };

  // Reset selection
  const resetSelection = () => {
    setSelectedSeats(new Set());
  };

  // Get seat counts by status
  const getSeatStats = () => {
    if (!seatData) return {};
    
    const stats = { available: 0, unavailable: 0, void: 0, sold: 0 };
    
    seatData.zones.forEach(zone => {
      zone.rows.forEach(row => {
        row.seats.forEach(seat => {
          const status = seat.status ? seat.status.toLowerCase() : 'available';
          if (stats.hasOwnProperty(status)) {
            stats[status]++;
          }
        });
      });
    });
    
    return stats;
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
                onClick={copyToClipboard}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy JSON
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
                  {seatData.categories.map(category => (
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
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                updateCategoryName(category.name, editCategoryName);
                              }
                              if (e.key === 'Escape') {
                                cancelEditingCategory();
                              }
                            }}
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
      {showOutput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-3/4 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">JSON Output</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(seatData, null, 2));
                      alert('✅ JSON successfully copied to clipboard!');
                    } catch (error) {
                      alert('❌ Failed to copy to clipboard. Please select and copy manually.');
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Copy className="w-4 h-4 mr-2 inline" />
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
            <div className="flex-1 p-4 overflow-auto">
              <textarea
                value={JSON.stringify(seatData, null, 2)}
                readOnly
                className="w-full h-full font-mono text-sm border rounded-lg p-4 resize-none"
                style={{ minHeight: '500px' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SeatMapEditor;