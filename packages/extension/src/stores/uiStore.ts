import { create } from 'zustand';
import type { GroupsState } from '@/lib/types';

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
  | null;

interface ModalState {
  type: ModalType;
  data?: Record<string, unknown>;
}

interface RenameTarget {
  kind: 'group' | 'window';
  groupIndex: number;
  windowIndex?: number;
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

  // Undo/redo stack (max 10)
  undoStack: GroupsState[];
  redoStack: GroupsState[];

  // Selection mode
  selectionMode: boolean;
  selectedItems: SelectedItem[];

  // Actions
  openModal: (type: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setActiveGroupIndex: (index: number) => void;
  setSearchFilter: (filter: string) => void;
  setRenameTarget: (target: RenameTarget | null) => void;
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
  clearSelection: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  modal: { type: null },
  activeGroupIndex: 0,
  searchFilter: '',
  renameTarget: null,
  undoStack: [],
  redoStack: [],
  selectionMode: false,
  selectedItems: [],

  openModal: (type, data) => set({ modal: { type, data } }),
  closeModal: () => set({ modal: { type: null } }),
  setActiveGroupIndex: (index) => set({ activeGroupIndex: index }),
  setSearchFilter: (filter) => set({ searchFilter: filter }),
  setRenameTarget: (target) => set({ renameTarget: target }),

  pushUndo: (state) =>
    set((prev) => {
      const stack = [state, ...prev.undoStack].slice(0, 10);
      return { undoStack: stack, redoStack: [] };
    }),

  // currentState = the live GroupsState at the moment of the gesture (from TanStack Query cache)
  // It goes onto the opposite stack so the other direction can restore it.
  undo: (currentState: import('@/lib/types').GroupsState) => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return undefined;
    const [top, ...rest] = undoStack;
    set({ undoStack: rest, redoStack: [currentState, ...redoStack].slice(0, 10) });
    return top;
  },

  redo: (currentState: import('@/lib/types').GroupsState) => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return undefined;
    const [top, ...rest] = redoStack;
    set({ undoStack: [currentState, ...undoStack].slice(0, 10), redoStack: rest });
    return top;
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),

  enterSelectionMode: () => set({ selectionMode: true }),

  exitSelectionMode: () => set({ selectionMode: false, selectedItems: [] }),

  toggleSelectionMode: () =>
    set((prev) => ({
      selectionMode: !prev.selectionMode,
      // Clear items when leaving selection mode
      selectedItems: prev.selectionMode ? [] : prev.selectedItems
    })),

  toggleSelection: (item) =>
    set((prev) => {
      const { selectedItems } = prev;
      const committedType = selectedItems[0]?.type;
      // Switching to a different type clears the previous selection
      const base = committedType && committedType !== item.type ? [] : selectedItems;
      const exists = base.some((s) => s.id === item.id);
      return {
        selectedItems: exists ? base.filter((s) => s.id !== item.id) : [...base, item]
      };
    }),

  clearSelection: () => set({ selectedItems: [] })
}));
