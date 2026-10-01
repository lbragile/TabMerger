import { useRef } from 'react';
import { useKeyboardMove } from '@/hooks/useKeyboardMove';

/**
 * Mounted once inside `<DndProvider>`: runs the keyboard move-mode controller and owns
 * FOCUS while a move is live.
 *
 * The preview itself is not drawn here: it is the pointer drag's own preview (collapsed
 * source rows, the insertion gap through `applyGap`, the highlighted new-window / new-group
 * zones, the ghost docked in the gap). What this renders is the one stable, visually hidden
 * focusable element the controller moves focus to before the source row collapses, so focus
 * is never on a hidden element and the move's keys and announcements have a fixed owner.
 * The keys themselves are handled by the controller's document-level capture listener.
 */
export function KeyboardMoveHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  useKeyboardMove(hostRef);
  return (
    <div
      ref={hostRef}
      tabIndex={-1}
      role="group"
      aria-label="Moving items"
      data-testid="keyboard-move-host"
      className="sr-only focus:outline-none"
    />
  );
}
