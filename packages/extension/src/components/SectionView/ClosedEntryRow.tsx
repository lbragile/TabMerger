import { useId, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronDown, ChevronRight, Link2, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Group } from '@/lib/types';
import type { ClosedTab, RecentlyClosedEntry } from '@/lib/recentlyClosed';
import { formatClosedTime } from '@/lib/recentlyClosedDays';
import { formatTimeAgo } from '@/lib/i18n';
import { FALLBACK_FAVICON, getUrlDisplay } from '@/lib/savedTab';
import { READ_ONLY_TAB_ATTR, READ_ONLY_TAB_KEYS } from '@/lib/readOnlyListKeys';
import type { ClosedSaveTarget } from '@/lib/recentlyClosedSave';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';
import { cn } from '@/lib/utils';
import { SaveToGroupMenu } from './SaveToGroupMenu';

/** Marks an entry row's main button with the entry id (focus after a reopen or removal). */
export const CLOSED_ENTRY_ATTR = 'data-closed-entry';

/** The host shown in the address column ("github.com"), without `www.`. */
export function closedHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return getUrlDisplay(url);
  }
}

/** Ctrl/Cmd or middle click: open in the background and keep the popup open. */
export function isBackgroundClick(e: MouseEvent): boolean {
  return e.button === 1 || e.ctrlKey || e.metaKey;
}

const ROW_BUTTON =
  'flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
const ICON_BUTTON =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

function Favicon({ tab }: { tab: Pick<ClosedTab, 'favIconUrl'> }) {
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white dark:border-white/15 dark:bg-zinc-700">
      <img src={tab.favIconUrl || FALLBACK_FAVICON} alt="" className="h-3.5 w-3.5" onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }} />
    </span>
  );
}

/** Title and host in the same two columns as a saved tab row. */
function TitleAndHost({ title, host }: { title: string; host: string }) {
  return (
    <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,9rem)] items-center gap-x-1.5 overflow-hidden">
      <span dir="auto" className="block min-w-0 truncate text-xs leading-5 text-ui-start">{title}</span>
      <span dir="ltr" className="min-w-0 max-w-full truncate justify-self-start text-[10px] text-muted-foreground text-ui-start">{host}</span>
    </span>
  );
}

export interface ClosedEntryActions {
  reopen: (entry: RecentlyClosedEntry, opts?: { tabIndex?: number; background?: boolean }) => void;
  remove: (entry: RecentlyClosedEntry) => void;
  save: (entry: RecentlyClosedEntry, target: ClosedSaveTarget, groupName: string) => void;
  copyLink: (url: string) => void;
}

interface ClosedEntryRowProps {
  entry: RecentlyClosedEntry;
  groups: readonly Group[];
  actions: ClosedEntryActions;
  /** Faded by a search in "dim" mode. */
  dimmed?: boolean;
}

/**
 * One entry of a recently-closed day: its closed time, then a tab (favicon, title, host) or a
 * window ("Window · 6 tabs", first host +N, a chevron that lists its tabs). The row's button
 * reopens the tab or restores the window (Ctrl/Cmd or middle click: in the background); each tab
 * of an expanded window reopens on its own. The ⋯ menu: Reopen / Restore window, Save to group…,
 * Copy link (tabs) and Remove from list. Buttons carry the read-only list's arrow-key marker.
 */
export function ClosedEntryRow({ entry, groups, actions, dimmed }: ClosedEntryRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useCloseOnOverlayDismiss(() => setMenuOpen(false));
  const tabsId = useId();
  const isWindow = entry.kind === 'window';
  const first = entry.tabs[0];
  const time = formatClosedTime(entry.closedAt);
  const ago = formatTimeAgo(entry.closedAt);
  const title = isWindow
    ? t('recentlyClosed.entry.window', { tabs: t('common.tabCount', { count: entry.tabs.length }) })
    : first?.title || getUrlDisplay(first?.url) || t('tab.fallbackTitle');
  const host = first ? closedHost(first.url) : '';
  const name = isWindow ? title : first?.title || host;

  const open = (e: MouseEvent) => actions.reopen(entry, { background: isBackgroundClick(e) });

  return (
    <li className={cn('min-w-0', dimmed && 'opacity-40')}>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          {...{ [READ_ONLY_TAB_ATTR]: '', [CLOSED_ENTRY_ATTR]: entry.id }}
          aria-keyshortcuts={READ_ONLY_TAB_KEYS}
          aria-label={
            isWindow
              ? t('recentlyClosed.entry.restoreWindow', { tabs: t('common.tabCount', { count: entry.tabs.length }), time: ago })
              : t('recentlyClosed.entry.reopenTab', { title: name, time: ago })
          }
          className={ROW_BUTTON}
          title={isWindow ? undefined : first?.url}
          onClick={open}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          onAuxClick={(e) => { if (e.button === 1) open(e); }}
        >
          <span className="w-12 shrink-0 text-[10px] tabular-nums text-muted-foreground">{time}</span>
          {isWindow ? <AppWindow aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Favicon tab={first ?? {}} />}
          <TitleAndHost title={title} host={isWindow && entry.tabs.length > 1 ? `${host} +${entry.tabs.length - 1}` : host} />
        </button>
        {isWindow && (
          <button
            type="button"
            className={ICON_BUTTON}
            aria-expanded={expanded}
            aria-controls={expanded ? tabsId : undefined}
            aria-label={t('recentlyClosed.entry.windowTabs')}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />}
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BUTTON} aria-label={t('recentlyClosed.entry.moreOptions', { name })}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 text-xs">
            <DropdownMenuItem className="text-xs" onClick={() => actions.reopen(entry)}>
              <RotateCcw className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />
              {isWindow ? t('recentlyClosed.entry.restore') : t('recentlyClosed.entry.reopen')}
            </DropdownMenuItem>
            <SaveToGroupMenu
              groups={groups}
              entries={[entry]}
              label={t('recentlyClosed.entry.saveToGroup')}
              onSave={(target, groupName) => actions.save(entry, target, groupName)}
            />
            {!isWindow && first && (
              <DropdownMenuItem className="text-xs" onClick={() => actions.copyLink(first.url)}>
                <Link2 className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t('recentlyClosed.entry.copyLink')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-xs text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" onClick={() => actions.remove(entry)}>
              <Trash2 className="me-2 h-3.5 w-3.5 shrink-0" />
              {t('recentlyClosed.entry.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isWindow && expanded && (
        <ul id={tabsId} aria-label={t('recentlyClosed.entry.windowTabs')} className="ms-12 min-w-0 border-s border-border ps-1">
          {entry.tabs.map((tab, tabIndex) => {
            const tabTitle = tab.title || getUrlDisplay(tab.url) || t('tab.fallbackTitle');
            const reopenTab = (e: MouseEvent) => actions.reopen(entry, { tabIndex, background: isBackgroundClick(e) });
            return (
              <li key={tabIndex} className="min-w-0">
                <button
                  type="button"
                  {...{ [READ_ONLY_TAB_ATTR]: '' }}
                  aria-keyshortcuts={READ_ONLY_TAB_KEYS}
                  aria-label={t('recentlyClosed.entry.reopenTabInWindow', { title: tabTitle })}
                  className={ROW_BUTTON}
                  title={tab.url}
                  onClick={reopenTab}
                  onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onAuxClick={(e) => { if (e.button === 1) reopenTab(e); }}
                >
                  <Favicon tab={tab} />
                  <TitleAndHost title={tabTitle} host={closedHost(tab.url)} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
