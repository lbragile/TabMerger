import type { KeyboardEventHandler, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useScrollFades } from '@/hooks/useScrollFades';

interface FadedScrollAreaProps {
  children: ReactNode;
  /** Classes of the scrolling element (its padding). */
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /**
   * Where the top fade starts: under a sticky header, so what scrolls beneath it fades out
   * (`top-[var(--section-group-header)]` in a session); the top edge when omitted.
   */
  topFadeClassName?: string;
}

/**
 * The two fades share this: decorative, never catch the pointer, stop short of the 4px scrollbar.
 * Layer 1: above the tab rows, under the sticky window tiles (2) and group headers (3).
 */
const FADE = 'pointer-events-none absolute z-[1] start-0 end-1 transition-opacity duration-100 motion-reduce:transition-none';

/**
 * A vertical scroll area with edge fades (`useScrollFades`): at the top once scrolled, at the
 * bottom while there is more below. The fades are in the panel's background colour, so they
 * follow the theme, and are hidden from screen readers. The app's thin scrollbar applies.
 */
export function FadedScrollArea({ children, className, onKeyDown, topFadeClassName = 'top-0' }: FadedScrollAreaProps) {
  const { ref, fades } = useScrollFades<HTMLDivElement>();
  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div ref={ref} className={cn('scrollbar-themed h-full min-w-0 overflow-y-auto overflow-x-hidden', className)} onKeyDown={onKeyDown} data-faded-scroll="">
        <div className="min-w-0">{children}</div>
      </div>
      <span
        aria-hidden="true"
        data-fade="top"
        className={cn(FADE, topFadeClassName, 'h-3.5 bg-linear-to-b from-background to-transparent', fades.top ? 'opacity-100' : 'opacity-0')}
      />
      <span
        aria-hidden="true"
        data-fade="bottom"
        className={cn(FADE, 'bottom-0 h-7 bg-linear-to-t from-background to-transparent', fades.bottom ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}
