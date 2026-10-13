import { useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { readTourRecord, shouldAutoStartTour } from '@/lib/tour';
import { trackEvent } from '@/lib/analytics';

/**
 * Starts the tour by itself when the popup opens and the stored record says it is pending:
 * the first popup open after a first install, or a tour the user had not finished when the
 * popup last closed (it resumes at the remembered step). Does nothing once the tour was
 * finished or skipped, for users who only ever updated, and in demo builds.
 */
export function useTourAutoStart(): void {
  const startTour = useUIStore((s) => s.startTour);
  const tourActive = useUIStore((s) => s.tourActive);

  useEffect(() => {
    // Already running (started by hand before the read came back): leave it alone
    if (tourActive) return;
    let cancelled = false;
    void readTourRecord().then((record) => {
      if (cancelled || !shouldAutoStartTour(record)) return;
      // A resumed tour was already counted when it first started
      if (!record?.stepId) trackEvent('tour_started', { source: 'auto' });
      startTour(record?.stepId, record?.practiceGroupId);
    });
    return () => {
      cancelled = true;
    };
    // Once per popup open: re-reading when a tour ends would be pointless (it is `done` by then)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
