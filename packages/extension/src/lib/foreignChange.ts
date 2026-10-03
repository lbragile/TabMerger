/**
 * "Another device / context changed the groups under us." Emitted when a pull or a realtime event
 * APPLIES remote changes. The popup clears its undo/redo history on it: a snapshot older than
 * those changes would, when restored, prune or revert them (and queue a remote DELETE or a stale
 * push). Clearing is the simplest deterministic rule; undo is for the user's own recent actions.
 */
const listeners = new Set<() => void>();

export function onForeignGroupsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitForeignGroupsChange(): void {
  listeners.forEach((fn) => fn());
}

const conflictListeners = new Set<(names: string[]) => void>();

/** Subscribes to "a sync conflict saved this device edit as a copy" (names of the groups affected). */
export function onSyncConflict(fn: (names: string[]) => void): () => void {
  conflictListeners.add(fn);
  return () => {
    conflictListeners.delete(fn);
  };
}

export function emitSyncConflict(names: string[]): void {
  conflictListeners.forEach((fn) => fn(names));
}
