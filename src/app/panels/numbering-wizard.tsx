'use client';
import React, { useMemo, useState } from 'react';
import { X, Wand2 } from 'lucide-react';
import type { SeatData, Row, Zone, Seat } from '../model/types';
import { orderedSeatIndices } from '../model/ops';

export interface NumberingOptions {
  scope: 'all' | 'selected';
  rowNameMode: 'keep' | 'letters' | 'numbers' | 'custom';
  rowNameStart: string;          // "A" for letters, "1" for numbers
  rowOrderBottomUp: boolean;     // assign names starting from the bottom-most (stage-side) row
  customRowNames: string;        // comma/space separated list
  seatScheme: 'keep' | 'numeric' | 'lower' | 'upper';
  seatStart: number;
  seatReversed: boolean;         // number right-to-left
  continueAcrossRows: boolean;   // don't restart the counter per row
  template: string;              // tokens {row} and {n} (or %s)
  mode: 'tiptip' | 'pretix';     // tiptip: full label baked into seat_number
  showStart: boolean;            // row label visibility -> row_number_position
  showEnd: boolean;
}

export const DEFAULT_OPTIONS: NumberingOptions = {
  scope: 'all',
  rowNameMode: 'letters',
  rowNameStart: 'A',
  rowOrderBottomUp: true,
  customRowNames: '',
  seatScheme: 'numeric',
  seatStart: 1,
  seatReversed: false,
  continueAcrossRows: false,
  template: '{row}{n}',
  mode: 'tiptip',
  showStart: true,
  showEnd: true,
};

// 0 -> A, 25 -> Z, 26 -> AA (bijective base-26)
const lettersFromIndex = (i: number, upper: boolean): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return upper ? s : s.toLowerCase();
};

const letterToIndex = (s: string): number => {
  let n = 0;
  for (const c of s.toUpperCase()) {
    const code = c.charCodeAt(0);
    if (code < 65 || code > 90) return 0;
    n = n * 26 + (code - 64);
  }
  return Math.max(0, n - 1);
};

interface TargetRow {
  zone: Zone;
  row: Row;
  sortY: number;
}

const collectTargetRows = (data: SeatData, selected: Set<string>, scope: 'all' | 'selected'): TargetRow[] => {
  const targets: TargetRow[] = [];
  data.zones.forEach((zone: Zone) => {
    zone.rows.forEach((row: Row) => {
      if (!row.seats || row.seats.length === 0) return;
      if (scope === 'selected' && !row.seats.some(s => selected.has(s.seat_guid))) return;
      const zy = zone.position?.y ?? 0;
      const ry = row.position?.y ?? 0;
      const meanY = row.seats.reduce((acc, s) => acc + s.position.y, 0) / row.seats.length;
      targets.push({ zone, row, sortY: zy + ry + meanY });
    });
  });
  return targets;
};

const renderTemplate = (template: string, rowName: string, n: string, catAlias: string = ''): string =>
  template.replaceAll('{row}', rowName).replaceAll('{n}', n).replaceAll('{cat}', catAlias).replaceAll('%s', n);

export interface NumberingResult {
  next: SeatData;
  rowsChanged: number;
  seatsChanged: number;
  warning: string | null;
}

export function applyNumbering(data: SeatData, selected: Set<string>, opts: NumberingOptions): NumberingResult {
  const next: SeatData = structuredClone(data);
  const targets = collectTargetRows(next, selected, opts.scope);
  // Visual order: bottom row (closest to a bottom stage) first by default
  targets.sort((a, b) => (opts.rowOrderBottomUp ? b.sortY - a.sortY : a.sortY - b.sortY));

  let warning: string | null = null;
  const customNames = opts.customRowNames.split(/[\s,;]+/).filter(Boolean);
  let seatsChanged = 0;
  let counter = opts.seatStart;

  targets.forEach((t, rowIdx) => {
    const row = t.row;

    // Row name
    let rowName = row.row_number || '';
    if (opts.rowNameMode === 'letters') {
      rowName = lettersFromIndex(letterToIndex(opts.rowNameStart || 'A') + rowIdx, true);
    } else if (opts.rowNameMode === 'numbers') {
      rowName = String((parseInt(opts.rowNameStart, 10) || 1) + rowIdx);
    } else if (opts.rowNameMode === 'custom') {
      if (rowIdx < customNames.length) {
        rowName = customNames[rowIdx];
      } else {
        warning = `Custom list has ${customNames.length} names but ${targets.length} rows are targeted — extra rows kept their existing name.`;
      }
    }
    row.row_number = rowName;

    // Row label visibility
    if (opts.showStart && opts.showEnd) row.row_number_position = 'both';
    else if (opts.showStart) row.row_number_position = 'start';
    else if (opts.showEnd) row.row_number_position = 'end';
    else delete row.row_number_position;

    // Seat numbers + labels
    if (!opts.continueAcrossRows) counter = opts.seatStart;
    let order = orderedSeatIndices(row);
    if (opts.seatReversed) order = [...order].reverse();

    // Look up category alias for the {cat} token
    const catLookup = new Map(next.categories.map(c => [c.name, c.label || '']));

    order.forEach(seatIdx => {
      const seat: Seat = row.seats[seatIdx];
      let nValue: string;
      if (opts.seatScheme === 'keep') {
        nValue = seat.seat_number;
      } else {
        nValue =
          opts.seatScheme === 'numeric' ? String(counter)
          : lettersFromIndex(counter - 1, opts.seatScheme === 'upper');
        counter++;
      }
      const catAlias = catLookup.get(seat.category) || '';
      const label = renderTemplate(opts.template, rowName, nValue, catAlias);
      seat.seat_number = opts.mode === 'tiptip' ? label : nValue;
      seatsChanged++;
    });

    row.seat_label = opts.mode === 'tiptip'
      ? '%s'
      : renderTemplate(opts.template, rowName, '%s');
  });

  return { next, rowsChanged: targets.length, seatsChanged, warning };
}

// Preview: first rows + last row with sample labels.
// Always show rows in top-to-bottom physical order (ascending Y) so toggling
// "Start from bottom row" visibly swaps which physical row gets which name.
const buildPreview = (data: SeatData, selected: Set<string>, opts: NumberingOptions): { rows: { name: string; labels: string }[]; total: number } => {
  const { next } = applyNumbering(data, selected, opts);
  const targets = collectTargetRows(next, selected, opts.scope);
  // Physical order: top of canvas first (ascending Y)
  targets.sort((a, b) => a.sortY - b.sortY);
  const sample = targets.length <= 4 ? targets : [...targets.slice(0, 3), targets[targets.length - 1]];
  const rows = sample.map(t => {
    const order = orderedSeatIndices(t.row);
    const labels = order.map(i => t.row.seats[i].seat_number);
    const shown = labels.length <= 6 ? labels.join(', ') : `${labels.slice(0, 5).join(', ')}, … ${labels[labels.length - 1]}`;
    return { name: t.row.row_number || '—', labels: shown };
  });
  if (targets.length > 4) rows.splice(3, 0, { name: '⋮', labels: '' });
  return { rows, total: targets.length };
};

interface NumberingWizardProps {
  seatData: SeatData;
  selectedSeats: Set<string>;
  onApply: (result: NumberingResult) => void;
  onClose: () => void;
}

const inputCls = 'w-full px-2 py-1.5 text-sm border border-line rounded-lg bg-white';
const labelCls = 'text-sm font-medium text-ink';

const NumberingWizard: React.FC<NumberingWizardProps> = ({ seatData, selectedSeats, onApply, onClose }) => {
  const hasSelection = useMemo(
    () => seatData.zones.some(z => z.rows.some(r => r.seats.some(s => selectedSeats.has(s.seat_guid)))),
    [seatData, selectedSeats]
  );
  const [opts, setOpts] = useState<NumberingOptions>({
    ...DEFAULT_OPTIONS,
    scope: hasSelection ? 'selected' : 'all',
  });
  const set = <K extends keyof NumberingOptions>(key: K, value: NumberingOptions[K]): void =>
    setOpts(prev => ({ ...prev, [key]: value }));

  const preview = useMemo(() => {
    try {
      return buildPreview(seatData, selectedSeats, opts);
    } catch {
      return { rows: [], total: 0 };
    }
  }, [seatData, selectedSeats, opts]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-page rounded-t-lg">
          <div className="flex items-center space-x-2">
            <Wand2 className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold">Numbering &amp; Labels</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-soft hover:bg-subtle rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Scope */}
          <div>
            <div className={labelCls}>Apply to</div>
            <div className="flex space-x-2 mt-1.5">
              <button
                onClick={() => set('scope', 'all')}
                className={`px-3 py-1.5 text-sm rounded-lg border ${opts.scope === 'all' ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}
              >
                All rows
              </button>
              <button
                onClick={() => set('scope', 'selected')}
                disabled={!hasSelection}
                className={`px-3 py-1.5 text-sm rounded-lg border disabled:opacity-40 ${opts.scope === 'selected' ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}
              >
                Rows of selected seats
              </button>
            </div>
            <p className="text-xs text-ink-soft mt-1">
              Tip: for side blocks (e.g. left/right wings), select each block and run the wizard per block.
            </p>
          </div>

          {/* Row names */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="font-semibold text-sm">Row names</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Naming</label>
                <select value={opts.rowNameMode} onChange={e => set('rowNameMode', e.target.value as NumberingOptions['rowNameMode'])} className={inputCls}>
                  <option value="keep">Keep existing</option>
                  <option value="letters">Letters (A, B, … Z, AA)</option>
                  <option value="numbers">Numbers (1, 2, 3)</option>
                  <option value="custom">Custom list</option>
                </select>
              </div>
              {(opts.rowNameMode === 'letters' || opts.rowNameMode === 'numbers') && (
                <div>
                  <label className={labelCls}>Starting at</label>
                  <input value={opts.rowNameStart} onChange={e => set('rowNameStart', e.target.value)} className={inputCls} />
                </div>
              )}
            </div>
            {opts.rowNameMode === 'custom' && (
              <div>
                <label className={labelCls}>Names (comma separated, assigned in order)</label>
                <textarea
                  value={opts.customRowNames}
                  onChange={e => set('customRowNames', e.target.value)}
                  rows={2}
                  className={inputCls}
                  placeholder="A, B, C, AA, AB"
                />
              </div>
            )}
            {opts.rowNameMode !== 'keep' && (
              <label className="flex items-center space-x-2 text-sm text-ink">
                <input type="checkbox" checked={opts.rowOrderBottomUp} onChange={e => set('rowOrderBottomUp', e.target.checked)} />
                <span>Start from the bottom row (stage side)</span>
              </label>
            )}
            <div className="flex items-center space-x-4 text-sm text-ink">
              <span className={labelCls}>Show row labels:</span>
              <label className="flex items-center space-x-1.5">
                <input type="checkbox" checked={opts.showStart} onChange={e => set('showStart', e.target.checked)} />
                <span>at start</span>
              </label>
              <label className="flex items-center space-x-1.5">
                <input type="checkbox" checked={opts.showEnd} onChange={e => set('showEnd', e.target.checked)} />
                <span>at end</span>
              </label>
            </div>
          </div>

          {/* Seat numbers */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="font-semibold text-sm">Seat numbers</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Numbering</label>
                <select value={opts.seatScheme} onChange={e => set('seatScheme', e.target.value as NumberingOptions['seatScheme'])} className={inputCls}>
                  <option value="numeric">1, 2, 3, …</option>
                  <option value="lower">a, b, c, …</option>
                  <option value="upper">A, B, C, …</option>
                  <option value="keep">Keep existing numbers</option>
                </select>
              </div>
              {opts.seatScheme !== 'keep' && (
                <div>
                  <label className={labelCls}>Starting at</label>
                  <input
                    type="number"
                    value={opts.seatStart}
                    onChange={e => set('seatStart', Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={inputCls}
                  />
                </div>
              )}
            </div>
            {opts.seatScheme !== 'keep' && (
              <div className="flex items-center space-x-5 text-sm text-ink">
                <label className="flex items-center space-x-1.5">
                  <input type="checkbox" checked={opts.seatReversed} onChange={e => set('seatReversed', e.target.checked)} />
                  <span>Reversed (right → left)</span>
                </label>
                <label className="flex items-center space-x-1.5">
                  <input type="checkbox" checked={opts.continueAcrossRows} onChange={e => set('continueAcrossRows', e.target.checked)} />
                  <span>Continue across rows</span>
                </label>
              </div>
            )}
          </div>

          {/* Label template */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="font-semibold text-sm">Seat label</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Template — tokens: {'{row}'}, {'{n}'}, {'{cat}'}</label>
                <input value={opts.template} onChange={e => set('template', e.target.value)} className={inputCls} />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {['{row}{n}', '{row}-{n}', '{n}', '{cat}-{row}-{n}'].map(t => (
                    <button
                      key={t}
                      onClick={() => set('template', t)}
                      className={`px-2 py-0.5 text-xs rounded border ${opts.template === t ? 'bg-brand-50 border-brand text-brand' : 'bg-page border-line text-ink-soft'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Write as</label>
                <select value={opts.mode} onChange={e => set('mode', e.target.value as NumberingOptions['mode'])} className={inputCls}>
                  <option value="tiptip">TipTip — full label into seat number</option>
                  <option value="pretix">pretix — bare numbers + row template</option>
                </select>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-3 bg-page">
            <div className="font-semibold text-sm mb-2">
              Preview <span className="font-normal text-ink-soft">({preview.total} rows targeted)</span>
            </div>
            {preview.rows.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No rows targeted. The plan has no seats yet — close this wizard and use the Insert tool
                (armchair icon in the toolbar) to add a seat grid first, then come back to number it.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="pr-3 py-0.5 font-mono font-semibold text-ink whitespace-nowrap align-top">{r.name}</td>
                      <td className="py-0.5 font-mono text-ink-soft">{r.labels}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end space-x-2 p-4 border-t bg-page rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-subtle text-ink rounded-lg hover:bg-subtle">
            Cancel
          </button>
          <button
            onClick={() => onApply(applyNumbering(seatData, selectedSeats, opts))}
            disabled={preview.total === 0}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-600 disabled:bg-subtle"
          >
            Apply to {preview.total} row(s)
          </button>
        </div>
      </div>
    </div>
  );
};

export default NumberingWizard;
