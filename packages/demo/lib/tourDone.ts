// Marks the extension's guided tour as finished so it never covers the UI being recorded.
// A fresh profile gets `{ status: 'pending' }` from the background worker on install, and the
// popup auto-starts the tour from it. Overwriting it with `{ status: 'done' }` (the tour's own
// "finished or skipped" state) stops that.
import type { BrowserContext, Worker } from "@playwright/test";

// Mirrors TOUR_STORAGE_KEY in packages/extension/src/lib/tour.ts (the demo package does not
// import from the extension's source tree). Keep in sync with that file.
export const TOUR_STORAGE_KEY = "tm_tour";

// Shape per TourRecord in the same file: `{ status: 'done' }` needs no other field.
const TOUR_DONE_RECORD = { status: "done" } as const;

/** Finds the extension's service worker, waiting for it to start if needed. */
async function extensionWorker(context: BrowserContext): Promise<Worker> {
    const [sw] = context.serviceWorkers();
    return sw ?? (await context.waitForEvent("serviceworker"));
}

/**
 * Writes the "done" tour record into `chrome.storage.local`. Call it right after the context is
 * launched and before any popup page is opened (or reload the popup afterwards): the popup
 * reads the record on mount, so a page that is already open keeps showing the tour.
 *
 * The write goes after the background worker's install handler on purpose: the handler writes
 * `pending` on first install, so setting `done` first would be overwritten.
 */
export async function markTourDone(context: BrowserContext, worker?: Worker): Promise<void> {
    const sw = worker ?? (await extensionWorker(context));
    // Let the install handler's own `pending` write land first, then overwrite it. Wait for the
    // record to appear instead of a fixed delay; give up after 3 s (an updated profile, where the
    // handler writes nothing) and write `done` anyway.
    await sw.evaluate(
        async ([key, record]) => {
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                const stored = await chrome.storage.local.get(key);
                if (stored[key] !== undefined) break;
                await new Promise((r) => setTimeout(r, 50));
            }
            await chrome.storage.local.set({ [key]: record });
        },
        [TOUR_STORAGE_KEY, TOUR_DONE_RECORD] as const,
    );
}
