import { useEffect, useState } from 'react';
import { readTourRecord } from '@/lib/tour';
import { closeTourPracticeTab, isTourPracticeTabOpen, openTourPracticeTab } from '@/lib/tourPracticeTab';
import { setTourTabSandbox } from '@/lib/tourSandbox';

/**
 * Where the tour's spare browser tab stands. `off` = the step is not up, `pending` = being
 * opened, `ready` = open (`id` is its browser tab id), `failed` = the browser refused to open it
 * (the step is then shown read-only).
 */
export interface TourPracticeTab {
  id: number | null;
  state: 'off' | 'pending' | 'ready' | 'failed';
}

const OFF: TourPracticeTab = { id: null, state: 'off' };

/**
 * Owns the spare browser tab of the tour's "save a tab" step (`lib/tourPracticeTab.ts`).
 *
 * While `active`: the tab the stored record names is reused when it is still open (a popup that
 * was closed in the middle of the step), otherwise one is opened in the background. The drag
 * engine is told about it (`lib/tourSandbox.ts`), which is what allows that one tab, and
 * nothing else in "Now Open", to be dropped on the tour's practice groups.
 *
 * When `active` ends, for any reason (the step is done, Next, Back, a skipped step, chapter or
 * tour, the tour's overlay unmounting), the tab is closed again if it is still open and still
 * shows the practice page, and the drag engine goes back to its normal rules.
 */
export function useTourPracticeTab(active: boolean): TourPracticeTab {
  const [tab, setTab] = useState<TourPracticeTab>(OFF);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let opened: number | null = null;
    // Locked before the tab exists: until then nothing in Now Open can be moved at all
    setTourTabSandbox({ tabId: null });
    void (async () => {
      setTab({ id: null, state: 'pending' });
      const remembered = (await readTourRecord())?.practiceTabId ?? null;
      const id = (await isTourPracticeTabOpen(remembered)) ? remembered : await openTourPracticeTab();
      if (cancelled) {
        void closeTourPracticeTab(id);
        return;
      }
      opened = id;
      setTourTabSandbox({ tabId: id });
      setTab(id === null ? { id: null, state: 'failed' } : { id, state: 'ready' });
    })();
    return () => {
      cancelled = true;
      setTourTabSandbox(null);
      void closeTourPracticeTab(opened);
      setTab(OFF);
    };
  }, [active]);

  return tab;
}
