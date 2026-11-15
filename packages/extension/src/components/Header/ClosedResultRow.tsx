import type { MouseEvent } from 'react';
import { AppWindow, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Highlighted } from '@/components/Highlighted';
import { matchRanges, snippetAroundMatch, urlPrefixLength } from '@/lib/searchMatch';
import { closedWhenLabel, type ClosedSearchResult } from '@/lib/recentlyClosedSearch';

interface Props {
  /** Option id: the search box points at the active row with `aria-activedescendant`. */
  id: string;
  result: ClosedSearchResult;
  /** The plain words (marked in the title, else in the address). */
  tabQuery: string;
  /** The `tag:` filter (marked in the browser tab group badge). */
  tagQuery: string;
  active: boolean;
  onMouseEnter: () => void;
  /** `background`: Ctrl/Cmd or middle click, open without leaving the popup. */
  onPick: (background: boolean) => void;
}

/**
 * One "Recently closed" option in the search overlay: clock icon, the title, the address (the
 * matching part, when only the address matched), and when it was closed. A tab out of a closed
 * window says so; a whole window (`closed:` with no words) reads "Window · N tabs".
 */
export function ClosedResultRow({ id, result, tabQuery, tagQuery, active, onMouseEnter, onPick }: Props) {
  const { t } = useTranslation();
  const { entry, tab, tabIndex } = result;
  const wholeWindow = tabIndex === undefined;
  const label = wholeWindow
    ? t('search.closedWindowLabel', { tabs: t('common.tabCount', { count: entry.tabs.length }) })
    : tab.title || tab.url || t('common.untitled');
  const labelRanges = wholeWindow ? [] : matchRanges(label, tabQuery);
  // The address, from past its scheme; the matching part brought forward when only it matched.
  const urlRanges = !wholeWindow && labelRanges.length === 0 ? matchRanges(tab.url, tabQuery) : [];
  const url = urlRanges.length > 0
    ? snippetAroundMatch(tab.url, urlRanges, { skip: urlPrefixLength(tab.url), maxLead: 30, keep: 12 })
    : { text: wholeWindow ? '' : tab.url.slice(urlPrefixLength(tab.url)), ranges: [] };
  const chromeGroup = wholeWindow ? undefined : tab.tabGroup;

  const onClick = (e: MouseEvent) => onPick(e.ctrlKey || e.metaKey);
  return (
    <button type="button" role="option" id={id} aria-selected={active} tabIndex={-1}
      data-testid="search-closed-result"
      className={`flex items-center gap-2 w-full px-3 py-2 text-start transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onPick(true); } }}
    >
      {wholeWindow
        ? <AppWindow aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        : <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="flex-1 min-w-0">
        <span dir="auto" className="block text-[12px] font-medium truncate text-ui-start"><Highlighted text={label} ranges={labelRanges} /></span>
        {url.text && <span dir="ltr" className="block text-[10px] text-muted-foreground truncate text-ui-start"><Highlighted text={url.text} ranges={url.ranges} /></span>}
      </span>
      {chromeGroup && (
        <span dir="auto" className="shrink-0 max-w-[6rem] truncate text-[10px] font-medium px-1.5 py-0.5 text-white leading-none" style={{ backgroundColor: chromeGroup.color }}>
          <Highlighted text={chromeGroup.title} ranges={matchRanges(chromeGroup.title, tagQuery)} />
        </span>
      )}
      <span className="shrink-0 max-w-[9rem] text-end text-[10px] text-muted-foreground leading-tight">
        <span className="block truncate">{closedWhenLabel(entry.closedAt)}</span>
        {result.fromWindow && !wholeWindow && <span className="block truncate">{t('search.closedFromWindow')}</span>}
      </span>
    </button>
  );
}
