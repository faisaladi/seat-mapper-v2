'use client';
import React from 'react';
import { Upload, Copy, MousePointer, Grid3X3, Rows, Undo2, Redo2, Wand2, Armchair, FilePlus, Square, Circle, Type, Grid2x2, PenTool } from 'lucide-react';

// Top toolbar: selection modes, insert/shape/numbering tools,
// undo/redo, and the file actions (new / upload / export).

export type SelectionMode = 'area' | 'seats' | 'row';
export type ShapeKind = 'rectangle' | 'ellipse' | 'text';

interface ToolbarProps {
  hasData: boolean;
  selectionMode: SelectionMode;
  onSelectMode: (mode: SelectionMode) => void;
  onInsert: () => void;
  onShape: (shape: ShapeKind) => void;
  activeShape: ShapeKind | null;
  onPen: () => void;
  penActive: boolean;
  onWizard: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onNewPlan: () => void;
  onUploadClick: () => void;
  onExport: () => void;
}

const toolCls = (active: boolean, activeColor: 'blue' | 'purple' = 'blue'): string =>
  `w-9 h-9 flex items-center justify-center rounded-lg ${
    active
      ? activeColor === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
      : 'text-gray-600 hover:bg-gray-100'
  }`;

const Toolbar: React.FC<ToolbarProps> = ({
  hasData,
  selectionMode,
  onSelectMode,
  onInsert,
  onShape,
  activeShape,
  onPen,
  penActive,
  onWizard,
  showGrid,
  onToggleGrid,
  undo,
  redo,
  canUndo,
  canRedo,
  onNewPlan,
  onUploadClick,
  onExport,
}) => (
  <div className="bg-white border-b px-3 py-1.5 flex items-center space-x-1 flex-shrink-0">
    <h1 className="text-sm font-bold text-gray-800 pr-2 whitespace-nowrap">Seat Map Editor</h1>
    {hasData && (
      <>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={() => onSelectMode('area')} className={toolCls(selectionMode === 'area')} title="Select area — move seats, shapes & text (A)">
          <MousePointer className="w-4 h-4" />
        </button>
        <button onClick={() => onSelectMode('seats')} className={toolCls(selectionMode === 'seats')} title="Select seats by dragging (S)">
          <Grid3X3 className="w-4 h-4" />
        </button>
        <button onClick={() => onSelectMode('row')} className={toolCls(selectionMode === 'row')} title="Select rows (R)">
          <Rows className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={onInsert} className={toolCls(false)} title="Insert seat block">
          <Armchair className="w-4 h-4" />
        </button>
        <button onClick={() => onShape('rectangle')} className={toolCls(activeShape === 'rectangle', 'purple')} title="Draw rectangle (stage / section)">
          <Square className="w-4 h-4" />
        </button>
        <button onClick={() => onShape('ellipse')} className={toolCls(activeShape === 'ellipse', 'purple')} title="Draw ellipse">
          <Circle className="w-4 h-4" />
        </button>
        <button onClick={() => onShape('text')} className={toolCls(activeShape === 'text', 'purple')} title="Add text label">
          <Type className="w-4 h-4" />
        </button>
        <button onClick={onPen} className={toolCls(penActive, 'purple')} title="Pen — draw polygon / curves (click for corners, drag for curves)">
          <PenTool className="w-4 h-4" />
        </button>
        <button onClick={onWizard} className={toolCls(false)} title="Numbering & labels">
          <Wand2 className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={onToggleGrid} className={toolCls(showGrid)} title="Toggle grid + snap">
          <Grid2x2 className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button
          onClick={undo}
          disabled={!canUndo}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"
          title="Undo (⌘Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"
          title="Redo (⇧⌘Z)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </>
    )}
    <div className="flex-1" />
    <button
      onClick={onNewPlan}
      className="flex items-center px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors mr-2"
      title="Start a new plan"
    >
      <FilePlus className="w-4 h-4 mr-1.5" />
      New
    </button>
    <button
      onClick={onUploadClick}
      className="flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
    >
      <Upload className="w-4 h-4 mr-1.5" />
      Upload JSON
    </button>
    {hasData && (
      <button
        onClick={onExport}
        className="flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors ml-2"
      >
        <Copy className="w-4 h-4 mr-1.5" />
        Export JSON
      </button>
    )}
  </div>
);

export default Toolbar;
