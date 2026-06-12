'use client';
import React, { useRef, useState } from 'react';
import { Trash2, Check, X, Edit2, Plus, BringToFront, SendToBack, ChevronUp, ChevronDown } from 'lucide-react';
import type { SeatData, SelectedObject, Seat, Row, Area, Category, Zone } from '../model/types';
import type { RowLayout } from '../model/ops';
import { estimateSelectionSagitta } from '../model/ops';

// Contextual properties panel (pretix-style): what it shows depends on the
// current selection — plan / seats marquee / seat / row / area.

export interface PanelCallbacks {
  // seat + area fields route through the editor's updateObjectProperty
  commitObjectProp: (prop: string, value: string | number) => void;
  commitRowField: (field: 'row_number' | 'row_number_position', value: string) => void;
  rowLayoutStart: () => void;
  rowLayoutChange: (spacing: number, sagitta: number, gesture: boolean) => void;
  rowBulk: (field: 'radius' | 'category', value: number | string) => void;
  deleteSelection: () => void;
  commitPlanName: (name: string) => void;
  commitCanvasSize: (dim: 'width' | 'height', value: number) => void;
  applyStatus: (status: string) => void;
  clearSelection: () => void;
  assignCategory: (categoryIndex: number) => void;
  updateCategoryLabel: (categoryIndex: number, label: string) => void;
  updateCategoryName: (categoryIndex: number, name: string) => void;
  updateCategoryColor: (categoryIndex: number, color: string) => void;
  addCategory: () => void;
  deleteCategory: (categoryIndex: number) => void;
  selectCategorySeats: (categoryIndex: number) => void;
  selectionBendStart: () => void;
  selectionBendChange: (sagitta: number, gesture: boolean) => void;
  arrangeArea: (dir: 'front' | 'back' | 'forward' | 'backward') => void;
}

interface PropertiesPanelProps {
  seatData: SeatData;
  selectedObject: SelectedObject | null;
  selectedSeats: Set<string>;
  rowLayout: RowLayout | null;
  categoryCounts: Map<string, number>;
  callbacks: PanelCallbacks;
}

const STATUS_META: { key: string; label: string; outline: string }[] = [
  { key: 'available', label: 'Available', outline: '#22c55e' },
  { key: 'unavailable', label: 'Unavailable', outline: '#ef4444' },
  { key: 'void', label: 'Void', outline: '#6b7280' },
  { key: 'sold', label: 'Sold', outline: '#000000' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (s: string): boolean => UUID_RE.test(s.trim());

const fieldCls = 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white';
const labelCls = 'block text-xs font-medium text-gray-500 mb-1';
const sectionCls = 'text-sm font-semibold text-gray-800 pb-1.5 border-b';

const TextField: React.FC<{ label: string; value: string; onCommit: (v: string) => void; mono?: boolean }> = ({ label, value, onCommit, mono }) => (
  <div>
    {label && <label className={labelCls}>{label}</label>}
    <input
      key={value}
      type="text"
      defaultValue={value}
      onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${fieldCls} ${mono ? 'font-mono text-xs' : ''}`}
    />
  </div>
);

const NumberField: React.FC<{ label: string; value: number; onCommit: (v: number) => void; step?: number }> = ({ label, value, onCommit, step }) => {
  const display = Math.round(value * 10) / 10;
  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}
      <input
        key={display}
        type="number"
        step={step ?? 1}
        defaultValue={display}
        onBlur={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && Math.abs(v - display) > 0.01) onCommit(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={fieldCls}
      />
    </div>
  );
};

const SelectField: React.FC<{ label: string; value: string; options: { value: string; label: string }[]; onCommit: (v: string) => void }> = ({ label, value, options, onCommit }) => (
  <div>
    {label && <label className={labelCls}>{label}</label>}
    <select value={value} onChange={(e) => onCommit(e.target.value)} className={fieldCls}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const ColorField: React.FC<{ label: string; value: string; onCommit: (v: string) => void }> = ({ label, value, onCommit }) => (
  <div>
    <label className={labelCls}>{label}</label>
    <div className="flex items-center space-x-2">
      <input
        key={value}
        type="color"
        defaultValue={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc'}
        onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
        className="w-9 h-8 border border-gray-300 rounded cursor-pointer"
      />
      <span className="text-xs font-mono text-gray-500">{value}</span>
    </div>
  </div>
);

const DeleteButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center justify-center px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
  >
    <Trash2 className="w-4 h-4 mr-2" />
    {label}
  </button>
);

const categoryOptions = (categories: Category[], extra?: { value: string; label: string }): { value: string; label: string }[] => {
  const opts = categories.map(c => ({ value: c.name, label: c.label || c.name.slice(0, 18) + '…' }));
  return extra ? [extra, ...opts] : opts;
};

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ seatData, selectedObject, selectedSeats, rowLayout, categoryCounts, callbacks }) => {
  // Curve slider: live preview while dragging, single undo step (gesture
  // starts on pointer-down, layout changes are applied without new gestures)
  const dragSpacingRef = useRef<number>(25);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  // Selection bend slider: live value while dragging
  const [selSliderValue, setSelSliderValue] = useState<number | null>(null);
  // Selection view: chosen status before applying
  const [statusChoice, setStatusChoice] = useState<string>('available');
  // Plan view: category UUID editing
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState<string>('');

  let content: React.ReactNode;

  if (selectedObject?.type === 'row' && rowLayout) {
    const row = selectedObject.data as Row;
    const firstSeat = row.seats[0];
    const rowCategories = new Set(row.seats.map(s => s.category));
    const sharedCategory = rowCategories.size === 1 ? row.seats[0].category : '';
    const sagitta = sliderValue ?? Math.round(rowLayout.sagitta);

    content = (
      <div className="space-y-3">
        <div className={sectionCls}>Row · {row.seats.length} seats</div>
        <TextField label="Row number" value={row.row_number || ''} onCommit={(v) => callbacks.commitRowField('row_number', v)} />
        <SelectField
          label="Row label"
          value={row.row_number_position || ''}
          options={[
            { value: '', label: 'Hidden' },
            { value: 'start', label: 'At start' },
            { value: 'end', label: 'At end' },
            { value: 'both', label: 'Both ends' },
          ]}
          onCommit={(v) => callbacks.commitRowField('row_number_position', v)}
        />
        <NumberField
          label="Seat spacing"
          value={rowLayout.spacing}
          onCommit={(v) => callbacks.rowLayoutChange(Math.max(2, v), rowLayout.sagitta, true)}
        />
        <div>
          <label className={labelCls}>Curve (drag to bend)</label>
          <input
            type="range"
            min={-300}
            max={300}
            step={1}
            value={sagitta}
            onPointerDown={() => {
              dragSpacingRef.current = rowLayout.spacing;
              callbacks.rowLayoutStart();
            }}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setSliderValue(v);
              callbacks.rowLayoutChange(dragSpacingRef.current, v, false);
            }}
            onPointerUp={() => setSliderValue(null)}
            className="w-full accent-purple-600"
          />
          <div className="flex items-center justify-between">
            <NumberField label="" value={rowLayout.sagitta} onCommit={(v) => callbacks.rowLayoutChange(rowLayout.spacing, v, true)} />
            <button
              onClick={() => callbacks.rowLayoutChange(rowLayout.spacing, 0, true)}
              className="ml-2 px-2 py-1.5 text-xs bg-gray-100 border rounded hover:bg-gray-200 whitespace-nowrap"
            >
              Straighten
            </button>
          </div>
        </div>
        <NumberField label="Seat radius (all seats)" value={firstSeat?.radius || 8} onCommit={(v) => callbacks.rowBulk('radius', Math.max(2, v))} />
        <SelectField
          label="Category (all seats)"
          value={sharedCategory}
          options={categoryOptions(seatData.categories, { value: '', label: rowCategories.size > 1 ? '(mixed)' : '(none)' })}
          onCommit={(v) => { if (v) callbacks.rowBulk('category', v); }}
        />
        <DeleteButton label="Delete row" onClick={callbacks.deleteSelection} />
      </div>
    );
  } else if (selectedObject?.type === 'seat') {
    const seat = selectedObject.data as Seat;
    content = (
      <div className="space-y-3">
        <div className={sectionCls}>Seat</div>
        <TextField label="Seat number (label)" value={seat.seat_number} onCommit={(v) => callbacks.commitObjectProp('seat_number', v)} />
        <div>
          <label className={labelCls}>Seat ID</label>
          <div className="text-xs font-mono text-gray-500 break-all">{seat.seat_guid}</div>
        </div>
        <SelectField
          label="Status"
          value={(seat.status || 'available').toLowerCase()}
          options={STATUS_META.map(s => ({ value: s.key, label: s.label }))}
          onCommit={(v) => callbacks.commitObjectProp('status', v.toUpperCase())}
        />
        <SelectField
          label="Category"
          value={seat.category}
          options={categoryOptions(seatData.categories, { value: '', label: '(none)' })}
          onCommit={(v) => callbacks.commitObjectProp('category', v)}
        />
        <NumberField label="Radius" value={seat.radius || 8} onCommit={(v) => callbacks.commitObjectProp('radius', Math.max(2, v))} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={seat.position.x} onCommit={(v) => callbacks.commitObjectProp('position_x', v)} />
          <NumberField label="Y" value={seat.position.y} onCommit={(v) => callbacks.commitObjectProp('position_y', v)} />
        </div>
        <DeleteButton label="Delete seat" onClick={callbacks.deleteSelection} />
      </div>
    );
  } else if (selectedObject?.type === 'area') {
    const area = selectedObject.data as Area;
    content = (
      <div className="space-y-3">
        <div className={sectionCls}>Shape · {area.shape}</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={area.position.x} onCommit={(v) => callbacks.commitObjectProp('position_x', v)} />
          <NumberField label="Y" value={area.position.y} onCommit={(v) => callbacks.commitObjectProp('position_y', v)} />
        </div>
        {area.rectangle && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Width" value={area.rectangle.width} onCommit={(v) => callbacks.commitObjectProp('width', Math.max(1, v))} />
            <NumberField label="Height" value={area.rectangle.height} onCommit={(v) => callbacks.commitObjectProp('height', Math.max(1, v))} />
          </div>
        )}
        {area.circle && (
          <NumberField label="Radius" value={area.circle.radius} onCommit={(v) => callbacks.commitObjectProp('radius', Math.max(1, v))} />
        )}
        {area.ellipse && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Radius X" value={area.ellipse.radius.x} onCommit={(v) => callbacks.commitObjectProp('radius_x', Math.max(1, v))} />
            <NumberField label="Radius Y" value={area.ellipse.radius.y} onCommit={(v) => callbacks.commitObjectProp('radius_y', Math.max(1, v))} />
          </div>
        )}
        <NumberField label="Rotation (°)" value={area.rotation || 0} onCommit={(v) => callbacks.commitObjectProp('rotation', v)} />
        {area.shape !== 'text' && (
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Fill" value={area.color} onCommit={(v) => callbacks.commitObjectProp('color', v)} />
            <ColorField label="Border" value={area.border_color} onCommit={(v) => callbacks.commitObjectProp('border_color', v)} />
          </div>
        )}
        {area.text && (
          <>
            <TextField label="Text" value={area.text.text || ''} onCommit={(v) => callbacks.commitObjectProp('text', v)} />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Text size" value={area.text.size || 16} onCommit={(v) => callbacks.commitObjectProp('text_size', Math.max(4, v))} />
              <ColorField label="Text color" value={area.text.color || '#000000'} onCommit={(v) => callbacks.commitObjectProp('text_color', v)} />
            </div>
          </>
        )}
        <div>
          <label className={labelCls}>Arrange <span className="font-normal text-gray-400">(seats stay in front)</span></label>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden divide-x">
            {([
              ['back', SendToBack, 'Send to back'],
              ['backward', ChevronDown, 'Send backward'],
              ['forward', ChevronUp, 'Bring forward'],
              ['front', BringToFront, 'Bring to front'],
            ] as [ 'front' | 'back' | 'forward' | 'backward', typeof SendToBack, string ][]).map(([dir, Icon, tip]) => (
              <button
                key={dir}
                onClick={() => callbacks.arrangeArea(dir)}
                title={tip}
                className="flex-1 flex items-center justify-center py-1.5 text-gray-600 hover:bg-gray-100"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
        <DeleteButton label="Delete shape" onClick={callbacks.deleteSelection} />
      </div>
    );
  } else if (selectedSeats.size > 0) {
    content = (
      <div className="space-y-3">
        <div className={sectionCls}>{selectedSeats.size} seats selected</div>
        <div className="space-y-2">
          <SelectField
            label="Set status"
            value={statusChoice}
            options={STATUS_META.map(s => ({ value: s.key, label: s.label }))}
            onCommit={setStatusChoice}
          />
          <button
            onClick={() => callbacks.applyStatus(statusChoice)}
            className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Apply to {selectedSeats.size} seat(s)
          </button>
        </div>
        <div>
          <label className={labelCls}>Assign to category</label>
          <div className="space-y-1">
            {seatData.categories.map((c, i) => (
              <button
                key={i}
                onClick={() => callbacks.assignCategory(i)}
                className="w-full flex items-center space-x-2 px-2 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
              >
                <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <span className="flex-1 text-left truncate">{c.label || c.name.slice(0, 20) + '…'}</span>
                <span className="text-xs text-gray-400">{categoryCounts.get(c.name) || 0}</span>
              </button>
            ))}
          </div>
        </div>
        {selectedSeats.size > 1 && (() => {
          const selSagitta = selSliderValue ?? Math.round(estimateSelectionSagitta(seatData, selectedSeats));
          return (
            <div>
              <label className={labelCls}>Bend selection</label>
              <input
                type="range"
                min={-300}
                max={300}
                step={1}
                value={selSagitta}
                onPointerDown={() => callbacks.selectionBendStart()}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setSelSliderValue(v);
                  callbacks.selectionBendChange(v, false);
                }}
                onPointerUp={() => setSelSliderValue(null)}
                className="w-full accent-purple-600"
              />
              <div className="flex items-center justify-between">
                <NumberField label="" value={selSagitta} onCommit={(v) => callbacks.selectionBendChange(v, true)} />
                <button
                  onClick={() => callbacks.selectionBendChange(0, true)}
                  className="ml-2 px-2 py-1.5 text-xs bg-gray-100 border rounded hover:bg-gray-200 whitespace-nowrap"
                >
                  Straighten
                </button>
              </div>
            </div>
          );
        })()}
        <p className="text-xs text-gray-500">Arrow keys nudge the selection (⇧ = ×10).</p>
        <DeleteButton label={`Delete ${selectedSeats.size} seat(s)`} onClick={callbacks.deleteSelection} />
        <button
          onClick={callbacks.clearSelection}
          className="w-full px-3 py-2 text-sm bg-gray-100 text-gray-700 border rounded-lg hover:bg-gray-200 transition-colors"
        >
          Clear selection
        </button>
      </div>
    );
  } else {
    // Plan view: name, stats (with status legend colors), categories manager
    const stats: Record<string, number> = { available: 0, unavailable: 0, void: 0, sold: 0 };
    seatData.zones.forEach((z: Zone) => z.rows.forEach((r: Row) => r.seats.forEach((s: Seat) => {
      const k = (s.status || 'available').toLowerCase();
      if (k in stats) stats[k]++;
    })));
    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    content = (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className={sectionCls}>Plan</div>
          <TextField label="Name" value={seatData.name} onCommit={callbacks.commitPlanName} />
          <div>
            <label className={labelCls}>Canvas size <span className="font-normal text-gray-400">(TipTip renders against this)</span></label>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="" value={seatData.size?.width ?? 0} onCommit={(v) => callbacks.commitCanvasSize('width', v)} />
              <NumberField label="" value={seatData.size?.height ?? 0} onCommit={(v) => callbacks.commitCanvasSize('height', v)} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className={sectionCls}>Seats</div>
          {STATUS_META.map(s => (
            <div key={s.key} className="flex items-center text-sm">
              <span
                className="w-3.5 h-3.5 rounded-full border-2 mr-2 flex-shrink-0"
                style={{ backgroundColor: '#e5e7eb', borderColor: s.outline }}
              />
              <span className="flex-1 text-gray-600">{s.label}</span>
              <span className="font-medium tabular-nums">{stats[s.key]}</span>
            </div>
          ))}
          <div className="flex items-center text-sm border-t pt-1.5">
            <span className="flex-1 font-medium">Total</span>
            <span className="font-semibold tabular-nums">{total}</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className={sectionCls}>Categories</div>
          <p className="text-xs text-gray-500">
            Display name is stored in the file and survives ticket-UUID changes. The UUID below it is what TipTip reads — swap it per show.
          </p>
          {seatData.categories.map((category: Category, idx: number) => {
            const isEditing = editingCat === idx;
            const valid = isEditing ? isValidUUID(editCatName) : true;
            const commit = (): void => {
              if (!valid) return;
              callbacks.updateCategoryName(idx, editCatName);
              setEditingCat(null);
            };
            return (
              <div key={idx} className="p-2 border rounded-lg space-y-1">
                <div className="flex items-center space-x-2">
                  <label
                    className="relative w-4 h-4 rounded-full flex-shrink-0 cursor-pointer ring-offset-1 hover:ring-2 hover:ring-gray-300"
                    style={{ backgroundColor: category.color }}
                    title="Edit color"
                  >
                    <input
                      key={`${idx}:${category.color}`}
                      type="color"
                      defaultValue={/^#[0-9a-fA-F]{6}$/.test(category.color) ? category.color : '#cccccc'}
                      onBlur={(e) => { if (e.target.value !== category.color) callbacks.updateCategoryColor(idx, e.target.value); }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                  <input
                    key={`${idx}:${category.label ?? ''}`}
                    type="text"
                    defaultValue={category.label ?? ''}
                    placeholder="Display name (e.g. VIP)…"
                    onBlur={(e) => callbacks.updateCategoryLabel(idx, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="flex-1 min-w-0 px-1.5 py-1 text-sm font-medium border border-transparent hover:border-gray-300 focus:border-blue-400 rounded outline-none"
                  />
                  <button
                    onClick={() => callbacks.selectCategorySeats(idx)}
                    className="px-1.5 py-0.5 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-700 rounded whitespace-nowrap"
                    title="Select all seats in this category"
                  >
                    {categoryCounts.get(category.name) || 0} seats
                  </button>
                  <button
                    onClick={() => callbacks.deleteCategory(idx)}
                    className="p-1 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                    title="Delete category (must be empty)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isEditing ? (
                  <div className="flex flex-col pl-6 space-y-1">
                    <div className="flex items-center space-x-1">
                      <input
                        type="text"
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value.replace(/\s/g, ''))}
                        className={`flex-1 min-w-0 px-1.5 py-1 text-xs font-mono border rounded ${valid ? 'border-gray-300' : 'border-red-400 bg-red-50'}`}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit();
                          if (e.key === 'Escape') setEditingCat(null);
                        }}
                      />
                      <button
                        onClick={commit}
                        disabled={!valid}
                        className="p-1 text-green-600 hover:bg-green-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingCat(null)} className="p-1 text-red-600 hover:bg-red-100 rounded">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {!valid && (
                      <p className="text-xs text-red-500">Must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)</p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between pl-6">
                    <span className="text-xs font-mono text-gray-400 break-all" title="Ticket UUID (category name read by TipTip)">
                      {category.name}
                    </span>
                    <button
                      onClick={() => { setEditingCat(idx); setEditCatName(category.name); }}
                      className="p-1 text-blue-600 hover:bg-blue-100 rounded ml-1 flex-shrink-0"
                      title="Edit ticket UUID"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <button
            onClick={callbacks.addCategory}
            className="w-full flex items-center justify-center px-3 py-1.5 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add category
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Select a seat, row or shape to edit it. Use the toolbar to insert seats or run numbering.
        </p>
      </div>
    );
  }

  return (
    <div className="w-72 bg-white border-l p-4 overflow-y-auto flex-shrink-0">
      {content}
    </div>
  );
};

export default PropertiesPanel;
