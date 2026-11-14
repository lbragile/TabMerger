import { saveGroupsState } from './localDb';
import { demoData } from './demoData';
import { closeWindows } from './closeLiveTabs';

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
  // dev-only window reset for a recording: not a close to remember
  await closeWindows(
    allWindows.filter((w) => w.id !== undefined && w.id !== freshWindow?.id).map((w) => w.id as number),
    { record: false }
  );
}
