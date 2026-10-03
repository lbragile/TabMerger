/**
 * Cross-context mutual exclusion for a whole sync cycle (push + pull + merge). Cycles that overlap
 * (the popup's re-created doSync, the 30 s poll, the online event, the worker's SYNC_NOW, two popups)
 * could merge a pull that was fetched BEFORE another cycle's push and then drop the freshly pushed group.
 * `ifAvailable`: a cycle that finds the lock held is SKIPPED (the running one covers it), never queued.
 * Without the Web Locks API (jsdom) a flag on `globalThis` gives the same exclusion across module copies.
 */
const SYNC_LOCK_NAME = 'tabmerger-sync';
const RUNNING = Symbol.for('tabmerger.syncRunning');

export async function withSyncLock<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks?.request) {
    return locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? { ran: true as const, value: await task() } : { ran: false as const }));
  }
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[RUNNING]) return { ran: false };
  g[RUNNING] = true;
  try {
    return { ran: true, value: await task() };
  } finally {
    g[RUNNING] = false;
  }
}
