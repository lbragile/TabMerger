import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { inlineArrow } from '@/lib/direction';
import { INLINE_LINK } from '@/lib/inlineLink';
import { AXIS_HOURS, HOURS_IN_DAY, barHeightRem, busiestHours, hourAxisLabel, hourLabel } from '@/lib/recentlyClosedHours';
import { cn } from '@/lib/utils';

/** Marks an hour bar with its hour (0-23), for the strip's arrow keys and tests. */
export const CLOSED_HOUR_BAR_ATTR = 'data-closed-hour-bar';

/** Marks an hour marker of the day list with its hour (decorative: each row says its own time). */
export const CLOSED_HOUR_MARKER_ATTR = 'data-closed-hour-marker';

/** The keys an hour bar answers to (roving focus along the strip). */
const BAR_KEYS = 'ArrowLeft ArrowRight Home End';

/** Where each axis label sits in the 24-column grid (static classes, so Tailwind sees them). */
const AXIS_PLACE: Record<(typeof AXIS_HOURS)[number], string> = {
  0: 'col-start-1 justify-self-start',
  6: 'col-start-7 justify-self-center',
  12: 'col-start-13 justify-self-center',
  18: 'col-start-19 justify-self-center',
  23: 'col-start-24 justify-self-end'
};

interface ClosedHourStripProps {
  /** Entries per local hour of the whole day (index 0-23). */
  counts: readonly number[];
  /** The day's colour (`rgba(...)`), the bars' fill. */
  color: string;
  /** The hour shown on its own, or null. */
  picked: number | null;
  onPick: (hour: number | null) => void;
}

/** "Busiest: 16:00", the two busiest when tied, else how many hours had closes; "" for an empty day. */
function useDefaultStatus(counts: readonly number[]): string {
  const { t } = useTranslation();
  const busiest = busiestHours(counts);
  if (busiest.length === 0) return '';
  if (busiest.length === 1) return t('recentlyClosed.hours.busiest', { hour: hourLabel(busiest[0]) });
  if (busiest.length === 2) return t('recentlyClosed.hours.busiestTwo', { first: hourLabel(busiest[0]), second: hourLabel(busiest[1]) });
  return t('recentlyClosed.hours.spread', { count: counts.filter((n) => n > 0).length });
}

/**
 * The day view's activity strip: one slot per local hour 00-23 (following the reading direction).
 * An hour with closes is a bar button, as tall as its count next to the day's busiest hour, in the
 * day's colour; an empty hour is a decorative tick. A bar shows only its hour's entries
 * (`aria-pressed`, the other bars dim; again, or "Show all hours", shows every hour). The bars are
 * ONE tab stop: Left/Right (mirrored in right-to-left) and Home/End move between them. Under it,
 * the axis (00, 06, 12, 18, 23 in the locale's hour format) and a line saying the busiest hour or
 * the hour shown; that line is not a live region (picks are announced in the section status line).
 */
export function ClosedHourStrip({ counts, color, picked, onPick }: ClosedHourStripProps) {
  const { t } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);
  const [focusedHour, setFocusedHour] = useState<number | null>(null);
  const defaultStatus = useDefaultStatus(counts);
  const hours = counts.flatMap((n, hour) => (n > 0 ? [hour] : []));
  const max = Math.max(0, ...counts);
  const stop = focusedHour !== null && counts[focusedHour] > 0 ? focusedHour : (picked ?? hours[0]);

  const focusBar = (hour: number | undefined) => {
    if (hour === undefined) return;
    groupRef.current?.querySelector<HTMLButtonElement>(`[${CLOSED_HOUR_BAR_ATTR}="${hour}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const at = hours.indexOf(Number((e.target as HTMLElement).getAttribute(CLOSED_HOUR_BAR_ATTR)));
    if (at < 0) return;
    const move = inlineArrow(e.key);
    let next: number | undefined;
    if (move === 'end') next = hours[Math.min(at + 1, hours.length - 1)];
    else if (move === 'start') next = hours[Math.max(at - 1, 0)];
    else if (e.key === 'Home') next = hours[0];
    else if (e.key === 'End') next = hours[hours.length - 1];
    else return;
    e.preventDefault();
    focusBar(next);
  };

  const showAll = () => {
    const was = picked;
    onPick(null);
    // the link goes away with the filter: focus the bar that was picked instead of losing it
    if (was !== null) focusBar(was);
  };

  return (
    <div className="shrink-0 border-b border-border px-3 pb-1 pt-2" data-testid="closed-hour-strip">
      <div
        ref={groupRef}
        role="group"
        aria-label={t('recentlyClosed.hours.stripLabel')}
        className="grid h-11 grid-cols-24 gap-x-1"
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
          const count = counts[hour] ?? 0;
          const pressed = picked === hour;
          if (count === 0) {
            return (
              <span key={hour} aria-hidden className="flex flex-col justify-end">
                <span className="h-0.5 bg-border" />
                <span className="h-0.5" />
              </span>
            );
          }
          const label = t('recentlyClosed.hours.bar', { hour: hourLabel(hour), count });
          return (
            <button
              key={hour}
              type="button"
              {...{ [CLOSED_HOUR_BAR_ATTR]: hour }}
              aria-pressed={pressed}
              aria-label={label}
              aria-keyshortcuts={BAR_KEYS}
              title={label}
              tabIndex={hour === stop ? 0 : -1}
              className="group flex min-w-0 flex-col justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onFocus={() => setFocusedHour(hour)}
              onClick={() => onPick(pressed ? null : hour)}
            >
              <span
                className={cn('w-full', picked !== null && !pressed ? 'opacity-40 group-hover:opacity-70' : 'group-hover:opacity-80')}
                style={{ height: `${barHeightRem(count, max)}rem`, backgroundColor: color }}
              />
              {/* the picked bar is also underlined, so its state is not shown by colour alone */}
              <span className={cn('h-0.5', pressed && 'bg-foreground')} />
            </button>
          );
        })}
      </div>
      <div aria-hidden className="mt-0.5 grid grid-cols-24 gap-x-1 text-[10px] tabular-nums text-muted-foreground">
        {AXIS_HOURS.map((hour) => (
          <span key={hour} className={cn('row-start-1 whitespace-nowrap', AXIS_PLACE[hour])}>
            {hourAxisLabel(hour)}
          </span>
        ))}
      </div>
      <p className="flex min-h-5 min-w-0 items-center gap-2 text-[11px] text-muted-foreground" data-testid="closed-hour-status">
        <span className="min-w-0 truncate">
          {picked === null ? defaultStatus : t('recentlyClosed.hours.showing', { hour: hourLabel(picked), count: counts[picked] })}
        </span>
        {picked !== null && (
          <button type="button" className={cn(INLINE_LINK, 'shrink-0')} onClick={showAll}>
            {t('recentlyClosed.hours.showAll')}
          </button>
        )}
      </p>
    </div>
  );
}

/**
 * The end of an hour's entries: its start time, bold, and a hairline ("11:00 ───"). Below the
 * entries, so the newest-first list reads back in time (11:30, 11:02, 11:01, then 11:00). Hidden
 * from assistive tech (every row's name has its own time) and never focusable, so the arrow keys
 * and the focus after a removal go from row to row across hours.
 */
export function ClosedHourMarker({ hour }: { hour: number }) {
  return (
    <li aria-hidden className="flex min-w-0 items-center gap-2 px-1.5 pb-1.5 pt-0.5" {...{ [CLOSED_HOUR_MARKER_ATTR]: hour }}>
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-foreground">{hourLabel(hour)}</span>
      <span className="h-px min-w-0 flex-1 bg-foreground/20" />
    </li>
  );
}
