'use client';
import React from 'react';
import { X } from 'lucide-react';

// New plan modal: name + initial grid size (rows can be 0 for an empty plan).
// Opened from the landing screen AND the toolbar while editing.

export interface NewPlanForm {
  name: string;
  rows: number;
  seatsPerRow: number;
  spacing: number;
  rowSpacing: number;
  radius: number;
}

interface NewPlanModalProps {
  form: NewPlanForm;
  setForm: React.Dispatch<React.SetStateAction<NewPlanForm>>;
  replacesCurrent: boolean;
  onCancel: () => void;
  onCreate: () => void;
}

const NewPlanModal: React.FC<NewPlanModalProps> = ({ form, setForm, replacesCurrent, onCancel, onCreate }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg w-full max-w-sm">
      <div className="flex items-center justify-between p-4 border-b bg-page rounded-t-lg">
        <h3 className="text-base font-semibold">New plan</h3>
        <button onClick={onCancel} className="p-1.5 text-ink-soft hover:bg-subtle rounded">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">Plan name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-2 py-1.5 text-sm border border-line rounded-lg"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['rows', 'Rows'],
            ['seatsPerRow', 'Seats per row'],
            ['spacing', 'Seat spacing'],
            ['rowSpacing', 'Row spacing'],
            ['radius', 'Seat radius'],
          ] as [keyof Omit<NewPlanForm, 'name'>, string][]).map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-ink-soft mb-1">{label}</label>
              <input
                type="number"
                min={key === 'rows' || key === 'seatsPerRow' ? 0 : 1}
                value={form[key]}
                onChange={(e) => setForm(prev => ({ ...prev, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                className="w-full px-2 py-1.5 text-sm border border-line rounded-lg"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-soft">
          Set rows to 0 to start empty. You can always add more blocks later with the Insert tool.
        </p>
        {replacesCurrent && (
          <p className="text-xs text-red-600 font-medium">
            This replaces the plan you are editing — export it first if you need to keep it.
          </p>
        )}
      </div>
      <div className="flex items-center justify-end space-x-2 p-4 border-t bg-page rounded-b-lg">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm bg-subtle text-ink rounded-lg hover:bg-line"
        >
          Cancel
        </button>
        <button
          onClick={onCreate}
          className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-600"
        >
          {form.rows > 0 && form.seatsPerRow > 0
            ? `Create with ${form.rows} × ${form.seatsPerRow} seats`
            : 'Create empty plan'}
        </button>
      </div>
    </div>
  </div>
);

export default NewPlanModal;
