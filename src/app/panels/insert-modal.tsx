'use client';
import React from 'react';
import { X } from 'lucide-react';

// Insert seats modal: configure a rows × seats block, then arm the insert
// tool — the block is placed where the user next clicks on the canvas.

export interface InsertForm {
  rows: number;
  seatsPerRow: number;
  spacing: number;
  rowSpacing: number;
  radius: number;
}

interface InsertModalProps {
  form: InsertForm;
  setForm: React.Dispatch<React.SetStateAction<InsertForm>>;
  onCancel: () => void;
  onPlace: () => void;
}

const InsertModal: React.FC<InsertModalProps> = ({ form, setForm, onCancel, onPlace }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg w-full max-w-sm">
      <div className="flex items-center justify-between p-4 border-b bg-gray-50 rounded-t-lg">
        <h3 className="text-base font-semibold">Insert seats</h3>
        <button onClick={onCancel} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 grid grid-cols-2 gap-3">
        {([
          ['rows', 'Rows'],
          ['seatsPerRow', 'Seats per row'],
          ['spacing', 'Seat spacing'],
          ['rowSpacing', 'Row spacing'],
          ['radius', 'Seat radius'],
        ] as [keyof InsertForm, string][]).map(([key, label]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
            <input
              type="number"
              min={1}
              value={form[key]}
              onChange={(e) => setForm(prev => ({ ...prev, [key]: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end space-x-2 p-4 border-t bg-gray-50 rounded-b-lg">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          Cancel
        </button>
        <button
          onClick={onPlace}
          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          Place on canvas
        </button>
      </div>
    </div>
  </div>
);

export default InsertModal;
