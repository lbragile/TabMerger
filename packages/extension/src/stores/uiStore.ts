import { create } from 'zustand';
import type { GroupsState } from '@/lib/types';

export type ModalType =
  | 'addGroup'
  | 'deleteGroup'
  | 'deleteWindow'
  | 'deleteTab'
  | 'importExport'
  | 'settings'
  | 'auth'
  | 'upgrade'
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

interface UIState {
  modal: ModalState;
  activeGroupIndex: number;
  searchFilter: string;
  renameTarget: RenameTarget | null;

  // Undo/redo stack (max 10)
  undoStack: GroupsState[];
  redoStack: GroupsState[];

  // Actions
  openModal: (type: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setActiveGroupIndex: (index: number) => void;
  setSearchFilter: (filter: string) => void;
  setRenameTarget: (target: RenameTarget | null) => void;
  pushUndo: (state: GroupsState) => void;
  undo: () => GroupsState | undefined;
  redo: () => GroupsState | undefined;
  clearHistory: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  modal: { type: null },
  activeGroupIndex: 0,
  searchFilter: '',
  renameTarget: null,
  undoStack: [],
  redoStack: [],

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

  undo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return undefined;
    const [top, ...rest] = undoStack;
    set({ undoStack: rest, redoStack: [top, ...redoStack].slice(0, 10) });
    return top;
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    if (redoStack.length === 0) return undefined;
    const [top, ...rest] = redoStack;
    set({ undoStack: [top, ...undoStack].slice(0, 10), redoStack: rest });
    return top;
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] })
}));
