import { create } from 'zustand';
import type { MarkerSpec, MoveKind } from '@/lib/keyboardMove';

/**
 * Ephemeral UI state for keyboard MOVE MODE (see `@/lib/keyboardMove`, `useKeyboardMove`).
 * Rows ask to start a move through {@link KeyboardMoveStore.request}; the controller hook
 * consumes the request and publishes the live state (`kind`, `marker`) that the drop zones
 * and the new-window / new-group zone highlights render from (the insertion gap itself lives
 * in the DnD provider, fed through `applyGap`).
 */
interface KeyboardMoveStore {
  /** a row pressed Space: the controller starts a move for it, then clears this */
  request: { kind: MoveKind; id: string } | null;
  /** non-null while a move is live */
  kind: MoveKind | null;
  /** what to highlight for the current target */
  marker: MarkerSpec;
  requestMove: (kind: MoveKind, id: string) => void;
  clearRequest: () => void;
  setLive: (kind: MoveKind | null, marker: MarkerSpec) => void;
}

export const useKeyboardMoveStore = create<KeyboardMoveStore>((set) => ({
  request: null,
  kind: null,
  marker: null,
  requestMove: (kind, id) => set({ request: { kind, id } }),
  clearRequest: () => set({ request: null }),
  setLive: (kind, marker) => set({ kind, marker })
}));

/** Is a keyboard move of this kind live? (drives the drop zones' visibility) */
export const isKeyboardMoveLive = (): boolean => useKeyboardMoveStore.getState().kind !== null;
