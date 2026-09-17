import { create } from 'zustand';
import type { GroupsState } from '@/lib/types';
import { setSetting } from '@/lib/localDb';

export type ModalType =
  | 'addGroup'
  | 'deleteGroup'
  | 'deleteWindow'
  | 'deleteTab'
  | 'note'
  | 'importExport'
  | 'settings'
  | 'auth'
  | 'upgrade'
  | 'deduplicateGroup'
  | 'urlRules'
  | 'deleteSelection'
  | 'removeStaleTabs'
  | 'reviewStaleTabs'
  | 'clearAllData'
  | 'saveSession'
  | 'shortcutSavePicker'
  | 'reviewStaleGroup'
  | 'archiveStaleGroups'
  | 'encryptionSetup'
  | 'resetEncryption'
  | null;

interface ModalState {
  type: ModalType;
  data?: Record<string, unknown>;
}

interface RenameTarget {
  kind: 'group' | 'window' | 'tab';
  groupIndex: number;
  windowIndex?: number;
  tabIndex?: number;
}

export interface TabPositionTarget {
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
}

export type SelectionItemType = 'tab' | 'window' | 'group';

export interface SelectedItem {
  type: SelectionItemType;
  /** Matches the DnD id format: "tab-{gi}-{wi}-{ti}", "window-{gi}-{wi}", "group-{gi}" */
  id: string;
}

interface UIState {
  modal: ModalState;
  activeGroupIndex: number;
  searchFilter: string;
  renameTarget: RenameTarget | null;
  /** Set by a global keyboard shortcut to open the note editor for a specific tab row (consumed + cleared by TabItem). */
  noteTarget: TabPositionTarget | null;

  // Undo/redo stack (max 10)
  undoStack: GroupsState[];
  redoStack: GroupsState[];

  // Scroll-to-window: set when a search result selects a specific window; consumed and reset by WindowsPanel
  scrollToWindowIndex: number | null;

  // Selection mode
  selectionMode: boolean;
  selectedItems: SelectedItem[];
  /** Shift+click range anchor: the last item toggled ON (Ctrl/Cmd+click or checkbox). */
  selectionAnchor: SelectedItem | null;

  // Actions
  openModal: (type: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setActiveGroupIndex: (index: number) => void;
  setScrollToWindowIndex: (index: number | null) => void;
  setSearchFilter: (filter: string) => void;
  setRenameTarget: (target: RenameTarget | null) => void;
  setNoteTarget: (target: TabPositionTarget | null) => void;
  pushUndo: (state: GroupsState) => void;
  undo: (currentState: GroupsState) => GroupsState | undefined;
  redo: (currentState: GroupsState) => GroupsState | undefined;
  clearHistory: () => void;

  // Selection actions
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleSelectionMode: () => void;
  /** Toggles an item. Auto-clears selection if switching to a different type. */
  toggleSelection: (item: SelectedItem) => void;
  /**
   * Shift+click: enter selection mode and ADD `range` (anchor → `item` inclusive, visual
   * order, computed by `selectionRange`) to the selection. An empty `range` (no usable
   * anchor) selects just `item` and makes it the anchor. Type switch clears first.
   */
  selectRange: (item: SelectedItem, range: SelectedItem[]) => void;
  /** Replace the selection wholesale (e.g. remapped to new positions after a drop). */
  setSelection: (items: SelectedItem[]) => void;
  clearSelection: () => void;
}

/**
 * Central ephemeral UI store. Manages: active modal, active group index, search filter,
 * rename target, undo/redo stack (capped at 10 GroupsState snapshots), and selection mode.
 * None of this state is persisted — it resets when the popup closes. Use TanStack Query
 * (via `useGroups`) for durable group/tab data.
 */
export const useUIStore = create<UIState>((set, get) => ({
  modal: { type: null },
  activeGroupIndex: 0,
  scrollToWindowIndex: null,
  searchFilter: '',
  renameTarget: null,
  noteTarget: null,
  undoStack: [],
  redoStack: [],
  selectionMode: false,
  selectedItems: [],
  selectionAnchor: null,

  openModal: (type, data) => set({ modal: { type, data } }),
  closeModal: () => set({ modal: { type: null } }),
  setActiveGroupIndex: (index) => {
    set({ activeGroupIndex: index });
    // ponytail: fire-and-forget; .catch silences IndexedDB-unavailable errors in test env
    void setSetting('activeGroupIndex', index).catch(() => {});
  },
  setScrollToWindowIndex: (index) => set({ scrollToWindowIndex: index }),
  setSearchFilter: (filter) => set({ searchFilter: filter }),
  setRenameTarget: (target) => set({ renameTarget: target }),
  setNoteTarget: (target) => set({ noteTarget: target }),

  pushUndo: (state) =>
    set((prev) => {
      const stack = [state, ...prev.undoStack].slice(0, 10);
      return { undoStack: stack, redoStack: [] };
    }),

  /**
   * Pops the top undo snapshot and returns it. Pushes `currentState` (the live TanStack Query
   * cache value at the moment of the gesture) onto the redo stack so redo can reverse the undo.
   */
  undo: (currentState: import('@/lib/types').GroupsState) => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return undefined;
    const [top, ...rest] = undoStack;
    set({ undoStack: rest, redoStack: [currentState, ...redoStack].slice(0, 10) });
    return top;
  },

  /**
   * Pops the top redo snapshot and returns it. Pushes `currentState` back onto the undo stack
   * so the user can undo again after a redo.
   */
  redo: (currentState: import('@/lib/types').GroupsState) => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return undefined;
    const [top, ...rest] = redoStack;
    set({ undoStack: [currentState, ...undoStack].slice(0, 10), redoStack: rest });
    return top;
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),

  enterSelectionMode: () => set({ selectionMode: true }),

  exitSelectionMode: () => set({ selectionMode: false, selectedItems: [], selectionAnchor: null }),

  toggleSelectionMode: () =>
    set((prev) => ({
      selectionMode: !prev.selectionMode,
      // Clear items when leaving selection mode
      selectedItems: prev.selectionMode ? [] : prev.selectedItems,
      selectionAnchor: prev.selectionMode ? null : prev.selectionAnchor
    })),

  toggleSelection: (item) =>
    set((prev) => {
      const { selectedItems } = prev;
      const committedType = selectedItems[0]?.type;
      // Switching to a different type clears the previous selection
      const base = committedType && committedType !== item.type ? [] : selectedItems;
      const exists = base.some((s) => s.id === item.id);
      return {
        selectedItems: exists ? base.filter((s) => s.id !== item.id) : [...base, item],
        selectionAnchor: exists ? (prev.selectionAnchor?.id === item.id ? null : prev.selectionAnchor) : item
      };
    }),

  selectRange: (item, range) =>
    set((prev) => {
      const committedType = prev.selectedItems[0]?.type;
      const base = committedType && committedType !== item.type ? [] : prev.selectedItems;
      const additions = range.length > 0 ? range : [item];
      const have = new Set(base.map((s) => s.id));
      return {
        selectionMode: true,
        selectedItems: [...base, ...additions.filter((s) => s.type === item.type && !have.has(s.id))],
        // A range extends FROM the anchor, so it stays; with no usable anchor the clicked item becomes it.
        selectionAnchor: range.length > 0 && prev.selectionAnchor ? prev.selectionAnchor : item
      };
    }),

  setSelection: (items) => set({ selectedItems: items, selectionAnchor: items[0] ?? null }),

  clearSelection: () => set({ selectedItems: [], selectionAnchor: null })
}));
