import { useSyncExternalStore } from 'react';
import { getSectionViewStatus, subscribeSectionViewStatus } from '@/lib/sectionViewStatus';

/**
 * The polite live region for the sidebar's section views (see `lib/sectionViewStatus.ts`).
 * Always mounted by the app, outside the drag-and-drop tree, so its text changes never touch an
 * ancestor of a dragged row.
 */
export function SectionViewAnnouncer() {
  const message = useSyncExternalStore(subscribeSectionViewStatus, getSectionViewStatus, getSectionViewStatus);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="section-view-status">
      {message}
    </div>
  );
}
