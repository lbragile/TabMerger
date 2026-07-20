import { saveGroupsState } from './localDb';
import { demoData } from './demoData';

// ponytail: dev-only helper for the Playwright/Remotion marketing walkthrough — never called in prod builds

/**
 * Resets browser windows to a single blank window and seeds IndexedDB with
 * canned demo data, for use by an external Playwright script recording a
 * marketing walkthrough video. Never end up with zero windows — create the
 * fresh one first, then close everything else.
 */
export async function enterDemoMode(): Promise<void> {
  // seed first: window churn below tears down the popup's own window (and its JS context)
  await saveGroupsState(demoData);

  const freshWindow = await chrome.windows.create({ url: 'chrome://newtab' });

  const allWindows = await chrome.windows.getAll();
  await Promise.all(
    allWindows
      .filter((w) => w.id !== undefined && w.id !== freshWindow?.id)
      .map((w) => chrome.windows.remove(w.id as number))
  );
}
