import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed';
import { closedHour, countByHour, hourLabel } from '@/lib/recentlyClosedHours';
import { announceSectionView, clearSectionViewStatus } from '@/lib/sectionViewStatus';

/**
 * The hour picked on a recently-closed day's activity strip, and the entries it leaves.
 *
 * - `counts`: entries per local hour of the WHOLE day (search never changes the bars).
 * - `picked`: the hour shown on its own, or null for every hour. It goes back to null by itself
 *   once that hour has no entries left (reopened, removed, or an Undo that changed the day), and
 *   the view is keyed by its day, so another day always starts with every hour.
 * - `pick(hour | null)`: changes it and says so in the section status line ("Showing 16:00 · 3
 *   closed", "Showing all hours"): only on a user's pick, never on the automatic reset, and the
 *   text is cleared when the view goes away.
 */
export function useClosedHourFilter(entries: readonly RecentlyClosedEntry[]) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<number | null>(null);
  const counts = useMemo(() => countByHour(entries), [entries]);

  // the hour lost its last entry: back to every hour (adjusting state while rendering, no extra pass)
  if (chosen !== null && counts[chosen] === 0) setChosen(null);
  const picked = chosen !== null && counts[chosen] > 0 ? chosen : null;

  const inHour = useMemo(
    () => (picked === null ? entries : entries.filter((e) => closedHour(e.closedAt) === picked)),
    [entries, picked]
  );

  const announced = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (announced.current !== null) clearSectionViewStatus(announced.current);
    },
    []
  );

  const pick = (hour: number | null) => {
    const next = hour !== null && counts[hour] > 0 ? hour : null;
    setChosen(next);
    const text =
      next === null
        ? t('recentlyClosed.hours.showingAll')
        : t('recentlyClosed.hours.showing', { hour: hourLabel(next), count: counts[next] });
    announced.current = text;
    announceSectionView(text);
  };

  return { counts, picked, inHour, pick };
}
