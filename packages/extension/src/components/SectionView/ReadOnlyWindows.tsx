import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Window as SavedWindow } from '@/lib/types';
import { DEFAULT_WINDOW_TITLE } from '@/lib/types';
import { readableTextColor } from '@/lib/color';
import { cn } from '@/lib/utils';
import { handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys';
import { ReadOnlyTabRow } from './ReadOnlyTabRow';

interface ReadOnlyWindowsProps {
  windows: readonly SavedWindow[];
  /** The group these windows are in: its name starts each window's accessible name. */
  groupName: string;
  /** The group's colour: the number tiles and the rails are drawn in it. */
  color: string;
  /**
   * Whether a sticky group header sits above these windows (a session view): the window tiles
   * then stick just below it (`--section-group-header`) instead of at the top of the scroll area.
   */
  underGroupHeader?: boolean;
  /**
   * Whether this list handles the arrow keys itself. Off when an ancestor does it for several
   * lists at once (the session view: one list across all its groups).
   */
  ownArrowKeys?: boolean;
}

/** A saved window's own name, if it has one (not empty, not the placeholder new windows get). */
export function customWindowName(win: Pick<SavedWindow, 'name'>): string | undefined {
  const name = win.name?.trim();
  return name && name !== DEFAULT_WINDOW_TITLE ? name : undefined;
}

/**
 * Windows and their tabs, read-only, each as a bracket: a gutter with the window's number tile (in
 * the group's colour, black or white text by `readableTextColor`) and its tab count, sticky while
 * the window scrolls by, and a rail beside its tabs ending in a short foot. None of the windows
 * panel's editing (no drag and drop, keyboard move, selection, rename, notes, menus or drop
 * targets). Each window is a `role="group"` named "Launch, window 2, 2 tabs" (with its own name
 * when it has one, also shown above its first tab); the gutter is hidden from screen readers.
 * Rows carry none of the `data-group-index` / `data-window-index` / `data-tab-index` attributes
 * the popup's keyboard shortcuts act on, so Delete, F2 and N do nothing here. Used by the
 * archived-group and session views.
 */
export function ReadOnlyWindows({ windows, groupName, color, underGroupHeader = false, ownArrowKeys = true }: ReadOnlyWindowsProps) {
  const { t } = useTranslation();
  if (windows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{t('windows.noWindows')}</p>;
  }
  const itemColor = { '--item-color': color } as CSSProperties;
  const tileText = readableTextColor(color);
  return (
    <div className="min-w-0" onKeyDown={ownArrowKeys ? handleReadOnlyListKeyDown : undefined}>
      {windows.map((win, windowIndex) => {
        const tabs = win.tabs.filter(Boolean);
        const number = windowIndex + 1;
        const count = t('common.tabCount', { count: tabs.length });
        const name = customWindowName(win);
        const label = name
          ? t('sidePanel.view.windowLabelNamed', { group: groupName, name, number, tabs: count })
          : t('sidePanel.view.windowLabel', { group: groupName, number, tabs: count });
        return (
          <div key={windowIndex} role="group" aria-label={label} className="flex min-w-0 gap-2.5 pt-2" style={itemColor} data-read-only-window="">
            <div aria-hidden="true" className="relative w-11 shrink-0" data-window-gutter="">
              <span className="tm-bracket-rail absolute bottom-1.5 start-[calc(50%-1px)] top-1.5 w-0.5" />
              <span className="tm-bracket-rail absolute bottom-1.5 start-[calc(50%-1px)] h-0.5 w-2" />
              <div
                className={cn(
                  'sticky z-[2] flex flex-col items-center gap-[0.1875rem] bg-background pb-[0.3125rem] pt-0.5',
                  underGroupHeader ? 'top-[calc(var(--section-group-header)+0.5rem)]' : 'top-2'
                )}
                data-window-tile=""
              >
                <span className="flex h-[1.375rem] w-[1.375rem] items-center justify-center text-[0.6875rem] font-bold tabular-nums" style={{ backgroundColor: color, color: tileText }}>
                  {number}
                </span>
                <span className="whitespace-nowrap text-[0.625rem] leading-3 tabular-nums text-muted-foreground">{count}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {name && (
                <p aria-hidden="true" dir="auto" className="truncate px-2 pt-0.5 text-[0.6875rem] font-medium text-muted-foreground text-ui-start" title={name}>
                  {name}
                </p>
              )}
              <ul className="min-w-0">
                {tabs.map((tab, tabIndex) => <ReadOnlyTabRow key={tabIndex} tab={tab} />)}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}
