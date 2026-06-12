// Undo / redo: snapshot stack. beginGesture() is called once before every
// mutation (or at the start of a drag), so one user action = one undo step.
// Snapshots are fine at this data size; patch-based history can replace the
// internals later without changing this interface.

import { useCallback, useRef, useState } from 'react';
import type { SeatData } from '../model/types';

const HISTORY_LIMIT = 50;

export interface History {
  beginGesture: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const useHistory = (
  seatDataRef: React.RefObject<SeatData | null>,
  setSeatData: (data: SeatData) => void,
  onRestore: () => void
): History => {
  const undoStackRef = useRef<SeatData[]>([]);
  const redoStackRef = useRef<SeatData[]>([]);
  // Bumped on every stack change so canUndo/canRedo re-render the toolbar
  const [, setVersion] = useState<number>(0);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const beginGesture = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current) return;
    undoStackRef.current.push(structuredClone(current));
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    setVersion(v => v + 1);
  }, [seatDataRef]);

  const undo = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current || undoStackRef.current.length === 0) return;
    redoStackRef.current.push(structuredClone(current));
    setSeatData(undoStackRef.current.pop()!);
    onRestoreRef.current();
    setVersion(v => v + 1);
  }, [seatDataRef, setSeatData]);

  const redo = useCallback((): void => {
    const current = seatDataRef.current;
    if (!current || redoStackRef.current.length === 0) return;
    undoStackRef.current.push(structuredClone(current));
    setSeatData(redoStackRef.current.pop()!);
    onRestoreRef.current();
    setVersion(v => v + 1);
  }, [seatDataRef, setSeatData]);

  // Drop all history (new file loaded / new plan)
  const reset = useCallback((): void => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setVersion(v => v + 1);
  }, []);

  return {
    beginGesture,
    undo,
    redo,
    reset,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
  };
};
