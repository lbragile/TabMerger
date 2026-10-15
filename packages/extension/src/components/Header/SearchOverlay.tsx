import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Folder, AppWindow, X } from 'lucide-react';
import { SEARCH_COPY } from '@tabmerger/shared';
import { Input } from '@/components/ui/input';
import { parseSearchQuery } from '@/lib/utils';
import type { GroupsState } from '@/lib/types';
import { isHiddenFromSearch } from '@/lib/tourSandbox';
import { useTourSearchShowsDemo } from '@/hooks/useTourSearchShowsDemo';
import { Highlighted } from '@/components/Highlighted';
import { bestRank, matchRanges, matchRank, normalizeQuery, snippetAroundMatch, sortByRank, textMatches, urlPrefixLength, type MatchRange, type MatchRank } from '@/lib/searchMatch';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { motionScrollBehavior } from '@/lib/reducedMotion';
import { SEARCH_ANNOUNCE_DELAY_MS } from '@/components/SearchAnnouncer';

const EXAMPLES = [
    { query: 'react',     desc: 'Find any tab or group containing "react"' },
    { query: 'group:',    desc: 'Scope to a group — pick from your groups below' },
    { query: 'window:',   desc: 'Scope to a window — pick from your windows below' },
    { query: 'tag:',      desc: 'Filter by Chrome tab group label' },
];

/**
 * Returns picker context when the query ends with a bare `group:WORD`, `window:WORD`, or `tag:WORD` (no quotes yet).
 *
 * The `(?!")` negative lookahead prevents matching an already-completed `group:"My Group"`,
 * which would otherwise re-enter picker mode with `typed=""` and surface all groups.
 *
 * `lastIndexOf` is used because the prefix may appear earlier in the query — we always want the rightmost occurrence.
 */
function getPickerContext(query: string): { prefix: 'group:' | 'window:' | 'tag:'; typed: string; before: string } | null {
    const m = query.match(/(^|\s)(group:|window:|tag:)(?!")([^"\s]*)$/i);
    if (!m) return null;
    const matchStart = query.lastIndexOf(m[2]);
    return { prefix: m[2].toLowerCase() as 'group:' | 'window:' | 'tag:', typed: m[3], before: query.slice(0, matchStart) };
}

type Result =
    | { kind: 'group'; label: string; meta: string; groupIndex: number; color: string }
    | { kind: 'window'; label: string; meta: string; groupName: string; groupIndex: number; windowIndex: number; color: string }
    | { kind: 'tab'; label: string; meta: string; url?: string; groupIndex: number; windowIndex: number; tabIndex: number; groupColor: string; chromeGroup?: { name: string; color: string } };

/**
 * Converts a search query into a flat list of matching group and tab results.
 * Delegates keyword parsing (`in:`, `tag:`) to `parseSearchQuery`, then filters
 * groups and tabs accordingly. Groups are surfaced directly only when the query
 * is a pure group-name search; otherwise individual matching tabs are returned.
 *
 * Every filter is a contiguous, case-insensitive match (`textMatches`). Results are ordered best
 * match first (exact, then prefix, then word start, then anywhere: `matchRank`), keeping their
 * list order within a rank, and only then cut to the first 12.
 */
function getResults(query: string, groupsState: GroupsState | undefined): Result[] {
    if (!groupsState || !query.trim()) return [];
    const { groupFilter, windowFilter, tagFilter, tabQuery } = parseSearchQuery(query);
    const ranked: Array<{ result: Result; rank: MatchRank }> = [];
    const push = (result: Result, rank: MatchRank) => ranked.push({ result, rank });

    groupsState.available.forEach((group, groupIndex) => {
        // The guided tour's practice groups are not the user's: never a search result
        if (isHiddenFromSearch(group)) return;
        if (groupFilter && !textMatches(group.name, groupFilter)) return;
        const tabCount = group.windows.reduce((a, w) => a + w.tabs.length, 0);

        if (groupFilter && !tabQuery && !tagFilter && !windowFilter) {
            group.windows.forEach((win, windowIndex) => {
                push({ kind: 'window', label: win.name ?? 'Window', meta: `${win.tabs.length} tab${win.tabs.length !== 1 ? 's' : ''} · ${group.name}`, groupName: group.name, groupIndex, windowIndex, color: group.color }, matchRank(group.name, groupFilter));
            });
            return;
        }

        group.windows.forEach((win, windowIndex) => {
            if (windowFilter && !(win.name && textMatches(win.name, windowFilter))) return;

            win.tabs.forEach((tab, tabIndex) => {
                const titleMatch = !tabQuery || textMatches(tab.title, tabQuery) || textMatches(tab.url, tabQuery);
                // The Chrome tab group's label only, as in the windows panel (`tabMatchesFilters`)
                const tagMatch = !tagFilter || (!!tab.chromeGroup && textMatches(tab.chromeGroup.name, tagFilter));
                if (titleMatch && tagMatch) {
                    // Ranked by the most specific thing typed: the plain words, else the tag, window or group
                    const rank = tabQuery
                        ? bestRank(matchRank(tab.title, tabQuery), matchRank(tab.url, tabQuery))
                        : tagFilter
                          ? matchRank(tab.chromeGroup?.name, tagFilter)
                          : windowFilter
                            ? matchRank(win.name, windowFilter)
                            : matchRank(group.name, groupFilter);
                    push({ kind: 'tab', label: tab.title || tab.url || 'Untitled', meta: group.name, url: tab.url, groupIndex, windowIndex, tabIndex, groupColor: group.color, chromeGroup: tab.chromeGroup }, rank);
                }
            });
        });

        // Surface group by name only if the plain query actually matches it
        if (!tabQuery && !tagFilter && !groupFilter && !windowFilter && textMatches(group.name, query)) {
            push({ kind: 'group', label: group.name, meta: `${group.windows.length} windows · ${tabCount} tabs`, groupIndex, color: group.color }, matchRank(group.name, query));
        }
    });

    return sortByRank(ranked, (r) => r.rank).slice(0, 12).map((r) => r.result);
}

/** A picker's first 8 entries, best match first (with nothing typed yet, in list order). */
function rankPicks<T extends { name: string }>(picks: T[], typed: string): T[] {
    return (normalizeQuery(typed) ? sortByRank(picks, (p) => matchRank(p.name, typed)) : picks).slice(0, 8);
}

/**
 * Returns the groups whose names contain `typed` (best match first), used to populate the `group:` picker.
 * "Now Open" is listed like any saved group: its open tabs are searchable too.
 */
function getGroupPicks(typed: string, groupsState: GroupsState | undefined) {
    if (!groupsState) return [];
    const picks = groupsState.available
        .filter((g) => !isHiddenFromSearch(g) && textMatches(g.name, typed))
        .map((g) => ({ name: g.name, color: g.color, index: groupsState.available.indexOf(g) }));
    return rankPicks(picks, typed);
}

/**
 * Returns all windows across all groups whose names contain `typed`, used to populate the `window:` picker.
 * Each entry includes the group color for visual association and a `windowIndex` for navigation.
 */
function getWindowPicks(typed: string, groupsState: GroupsState | undefined, groupFilter: string): Array<{ name: string; color: string; index?: number; windowIndex: number; groupIndex: number }> {
    if (!groupsState) return [];
    const picks: Array<{ name: string; color: string; index?: number; windowIndex: number; groupIndex: number }> = [];
    groupsState.available.forEach((g, groupIndex) => {
        if (isHiddenFromSearch(g)) return;
        if (groupFilter && !textMatches(g.name, groupFilter)) return;
        g.windows.forEach((w, windowIndex) => {
            if (!w.name || !textMatches(w.name, typed)) return;
            picks.push({ name: w.name, color: g.color, windowIndex, groupIndex });
        });
    });
    return rankPicks(picks, typed);
}

/**
 * Collects unique Chrome tab group labels across all groups for the `tag:` picker.
 * Uses a Set to deduplicate — the same Chrome group label can appear on tabs in
 * multiple TabMerger groups.
 */
function getTagPicks(typed: string, groupsState: GroupsState | undefined) {
    if (!groupsState) return [];
    const seen = new Set<string>();
    const picks: { name: string; color: string }[] = [];
    groupsState.available.forEach((g) => {
        if (isHiddenFromSearch(g)) return;
        g.windows.forEach((w) => {
            w.tabs.forEach((t) => {
                if (t.chromeGroup && !seen.has(t.chromeGroup.name) && textMatches(t.chromeGroup.name, typed)) {
                    seen.add(t.chromeGroup.name);
                    picks.push({ name: t.chromeGroup.name, color: t.chromeGroup.color });
                }
            });
        });
    });
    return rankPicks(picks, typed);
}

interface Props {
    query: string;
    onQueryChange: (q: string) => void;
    groupsState: GroupsState | undefined;
    onSelectGroup: (index: number) => void;
    onSelectWindow: (groupIndex: number, windowIndex: number) => void;
    /** A tab result was picked. Optional: without it the tab's group is selected (`onSelectGroup`). */
    onSelectTab?: (groupIndex: number, windowIndex: number, tabIndex: number) => void;
    onClose: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Full-screen search overlay with three render modes:
 * - **Picker**: when query ends with bare `in:` or `tag:`, shows a group/tag pick list to autocomplete into a quoted token
 * - **Results**: when a non-empty query is typed, shows matching groups and tabs (max 12)
 * - **Examples**: when query is empty, shows example searches to onboard the user
 *
 * Selecting any result navigates to that group via `onSelectGroup`.
 */
export function SearchOverlay({ query, onQueryChange, groupsState, onSelectGroup, onSelectWindow, onSelectTab, onClose, inputRef }: Props) {
    const [cursor, setCursor] = useState(-1);
    // Suppresses results for one render cycle after a picker selection completes.
    // Without this, the render that transitions from picker→results mode can show
    // stale group data before the query fully settles.
    const [isPicking, setIsPicking] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    const pickerCtx = getPickerContext(query);
    const inPicker = pickerCtx !== null;
    // What to mark in each row: the same contiguous occurrence the list matched on (`matchRanges`).
    const parsed = useMemo(() => parseSearchQuery(query), [query]);
    // `isHiddenFromSearch` follows the guided tour's step: list again when its answer changes.
    const searchShowsDemo = useTourSearchShowsDemo();

    // Memoized: both feed the keydown-handler effect's dependency array below. Left as plain
    // per-render values, their array identity changes on every render regardless of whether
    // the query actually changed, which forces that effect to tear down and re-subscribe its
    // `window` keydown listener every render — wrapping in useMemo keys the recompute to the
    // actual inputs instead.
    const pickerItems: Array<{ name: string; color: string; index?: number; windowIndex?: number; groupIndex?: number }> = useMemo(() => {
        if (!pickerCtx) return [];
        if (pickerCtx.prefix === 'group:') return getGroupPicks(pickerCtx.typed, groupsState);
        if (pickerCtx.prefix === 'window:') return getWindowPicks(pickerCtx.typed, groupsState, parseSearchQuery(pickerCtx.before).groupFilter);
        return getTagPicks(pickerCtx.typed, groupsState);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pickerCtx, groupsState, searchShowsDemo]);

    const results = useMemo(
        () => (inPicker || isPicking) ? [] : getResults(query, groupsState),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [inPicker, isPicking, query, groupsState, searchShowsDemo]
    );
    const listLength = inPicker ? pickerItems.length : (query.trim() ? results.length : EXAMPLES.length);

    useEffect(() => { setCursor(-1); setIsPicking(false); }, [query]);

    // Combobox wiring: the input keeps the focus, the list's rows are options it points at
    const listId = useId();
    const optionId = useCallback((i: number) => `${listId}-option-${i}`, [listId]);
    const hasOptions = !isPicking && listLength > 0;
    const activeOption = hasOptions && cursor >= 0 && cursor < listLength ? optionId(cursor) : undefined;

    // Keep the row the arrows moved to inside the scrolled list
    useEffect(() => {
        if (cursor < 0) return;
        document.getElementById(optionId(cursor))?.scrollIntoView?.({ block: 'nearest', behavior: motionScrollBehavior() });
    }, [cursor, optionId]);

    // Polite count of what the list shows, once typing pauses (nothing for the examples)
    const countText = isPicking || !query.trim() ? '' : SEARCH_COPY.resultCount(listLength);
    const [announced, setAnnounced] = useState('');
    useEffect(() => {
        if (!countText) { setAnnounced(''); return; }
        const id = setTimeout(() => setAnnounced(countText), SEARCH_ANNOUNCE_DELAY_MS);
        return () => clearTimeout(id);
    }, [countText]);

    /**
     * Completes a picker selection by replacing the bare `in:WORD` / `tag:WORD` at the
     * end of the query with the quoted form `in:"Selected Name" `, then refocuses the
     * input so the user can continue typing a tab keyword (e.g. `in:"Work" report`).
     * Both the query update and refocus are deferred via setTimeout(0) so they run after
     * the click event fully settles — prevents the stale-render that showed wrong results.
     *
     * Wrapped in useCallback (not a plain function) so the keydown-handler effect below
     * can safely list it as a dependency: every value this closes over is either already
     * in the effect's own dependency array (`pickerCtx`, `onQueryChange`, `inputRef`) or a
     * setState setter, which React guarantees is referentially stable. So this reference
     * only changes when the effect was already going to re-subscribe anyway — adding it
     * satisfies exhaustive-deps without introducing any new re-run.
     */
    const completePick = useCallback((name: string, _groupIndex?: number) => {
        const newQuery = `${pickerCtx?.before ?? ''}${pickerCtx?.prefix}"${name}" `;
        setCursor(-1);
        setIsPicking(true);
        // Defer so the click event (and any blur/focus side-effects) fully settle before
        // the query update triggers a results re-render.
        setTimeout(() => {
            onQueryChange(newQuery);
            inputRef.current?.focus();
        }, 0);
    }, [pickerCtx, onQueryChange, inputRef]);

    const pickTab = useCallback((r: Result) => {
        if (r.kind === 'tab' && onSelectTab) onSelectTab(r.groupIndex, r.windowIndex, r.tabIndex);
        else onSelectGroup(r.groupIndex);
    }, [onSelectTab, onSelectGroup]);

    // Escape closes the overlay and leaves the typed text alone (only the user clears it).
    // Capture phase + preventDefault: the app's own Escape handler (leave selection mode)
    // skips an Escape that was already used.
    useEffect(() => {
        const onEscape = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            onClose();
        };
        window.addEventListener('keydown', onEscape, true);
        return () => window.removeEventListener('keydown', onEscape, true);
    }, [onClose]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, listLength - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter' && cursor >= 0) {
                e.preventDefault();
                if (inPicker) {
                    const item = pickerItems[cursor];
                    if (item) completePick(item.name, item.index);
                } else if (query.trim() && results[cursor]) {
                    const r = results[cursor];
                    if (r.kind === 'window') { onQueryChange(`${query.trimEnd()} window:"${r.label}" `); inputRef.current?.focus(); setCursor(-1); }
                    else pickTab(r);
                } else if (!query.trim() && EXAMPLES[cursor]) {
                    onQueryChange(EXAMPLES[cursor].query);
                    inputRef.current?.focus();
                    setCursor(-1);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cursor, listLength, inPicker, pickerItems, pickerCtx, results, query, onSelectGroup, onSelectWindow, onQueryChange, inputRef, completePick, pickTab]);

    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed left-1/2 -translate-x-1/2 z-50 w-[440px] rounded-none border border-border bg-popover shadow-2xl overflow-hidden"
                data-tour={TOUR_ANCHORS.searchOverlay}
                style={{ top: '8px' }}
            >
                {/* Input row */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                        ref={inputRef}
                        placeholder="Search tabs, groups…"
                        aria-label={SEARCH_COPY.searchInput}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={hasOptions}
                        aria-controls={hasOptions ? listId : undefined}
                        aria-activedescendant={activeOption}
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        className="h-7 text-sm border-0 shadow-none focus-visible:ring-0 p-0 bg-transparent"
                    />
                    {query && (
                        <button
                            type="button"
                            className="shrink-0 flex items-center justify-center h-5 w-5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={SEARCH_COPY.clearSearch}
                            data-testid="overlay-clear-search"
                            // Focus first: this button unmounts when the text is gone.
                            onClick={() => { inputRef.current?.focus(); onQueryChange(''); }}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <kbd className="text-[10px] text-muted-foreground border border-border px-1.5 py-px font-mono shrink-0">Ctrl K</kbd>
                </div>

                <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
                    {/* Picker mode: group:, window:, or tag: */}
                    {isPicking ? null : inPicker ? (
                        <div>
                            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                {pickerCtx.prefix === 'group:' ? 'Pick a group' : pickerCtx.prefix === 'window:' ? 'Pick a window' : 'Pick a tag'}
                            </p>
                            {pickerItems.length === 0 ? (
                                <p className="px-4 py-4 text-center text-[12px] text-muted-foreground">No matches</p>
                            ) : <div role="listbox" id={listId} aria-label={pickerCtx.prefix === 'group:' ? 'Groups' : pickerCtx.prefix === 'window:' ? 'Windows' : 'Tags'}>{pickerItems.map((item, i) => (
                                <button
                                    key={`${item.name}-${i}`}
                                    type="button"
                                    role="option"
                                    id={optionId(i)}
                                    aria-selected={cursor === i}
                                    tabIndex={-1}
                                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${cursor === i ? 'bg-muted' : 'hover:bg-muted/60'}`}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => completePick(item.name, item.index)}
                                >
                                    {pickerCtx.prefix === 'window:'
                                        ? <AppWindow className="h-3.5 w-3.5 shrink-0" style={{ color: item.color }} />
                                        : <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: item.color, fill: item.color }} />
                                    }
                                    <span className="text-[12px] font-medium truncate min-w-0"><Highlighted text={item.name} ranges={matchRanges(item.name, pickerCtx.typed)} /></span>
                                </button>
                            ))}</div>}
                        </div>
                    ) : query.trim() ? (
                        /* Search results */
                        results.length === 0 ? (
                            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">No matches for "{query}"</p>
                        ) : (
                            <div role="listbox" id={listId} aria-label="Search results">
                                {results.filter((r) => r.kind === 'group').length > 0 && (
                                    <div role="group" aria-labelledby={`${listId}-groups`}>
                                        <p id={`${listId}-groups`} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Groups</p>
                                        {results.filter((r) => r.kind === 'group').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            return <ResultRow key={`g${i}`} label={r.label} meta={r.meta}
                                                labelRanges={matchRanges(r.label, query)}
                                                folderColor={r.kind === 'group' ? r.color : undefined}
                                                id={optionId(ri)} active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => onSelectGroup(r.groupIndex)} />;
                                        })}
                                    </div>
                                )}
                                {results.filter((r) => r.kind === 'window').length > 0 && (
                                    <div role="group" aria-labelledby={`${listId}-windows`}>
                                        <p id={`${listId}-windows`} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Windows</p>
                                        {results.filter((r) => r.kind === 'window').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            return <ResultRow key={`w${i}`} label={r.label} meta={r.kind === 'window' ? r.meta : ''}
                                                labelRanges={matchRanges(r.label, parsed.windowFilter)}
                                                metaRanges={r.kind === 'window' ? shiftRanges(matchRanges(r.groupName, parsed.groupFilter), r.meta.length - r.groupName.length) : undefined}
                                                windowColor={r.kind === 'window' ? r.color : undefined}
                                                id={optionId(ri)} active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => { if (r.kind === 'window') { onQueryChange(`${query.trimEnd()} window:"${r.label}" `); inputRef.current?.focus(); setCursor(-1); } }} />;
                                        })}
                                    </div>
                                )}
                                {results.filter((r) => r.kind === 'tab').length > 0 && (
                                    <div role="group" aria-labelledby={`${listId}-tabs`}>
                                        <p id={`${listId}-tabs`} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tabs</p>
                                        {results.filter((r) => r.kind === 'tab').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            const labelRanges = matchRanges(r.label, parsed.tabQuery);
                                            // Found by its address only: show where, since the row lists the title.
                                            const urlRanges = r.kind === 'tab' && labelRanges.length === 0 && r.url ? matchRanges(r.url, parsed.tabQuery) : [];
                                            const urlMark = urlRanges.length > 0 && r.kind === 'tab' && r.url
                                                ? snippetAroundMatch(r.url, urlRanges, { skip: urlPrefixLength(r.url), maxLead: 30, keep: 12 })
                                                : undefined;
                                            return <ResultRow key={`t${i}`} label={r.label} meta={urlMark?.text ?? ''}
                                                labelRanges={labelRanges}
                                                metaRanges={urlMark?.ranges}
                                                groupQuery={parsed.groupFilter}
                                                tagQuery={parsed.tagFilter}
                                                folderColor={r.kind === 'tab' ? r.groupColor : undefined}
                                                groupName={r.kind === 'tab' ? r.meta : undefined}
                                                chromeGroupName={r.kind === 'tab' ? r.chromeGroup?.name : undefined}
                                                chromeGroupColor={r.kind === 'tab' ? r.chromeGroup?.color : undefined}
                                                id={optionId(ri)} active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => pickTab(r)} />;
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        /* Empty state — examples */
                        <div>
                            <p id={`${listId}-examples`} className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Try these searches</p>
                            <div role="listbox" id={listId} aria-labelledby={`${listId}-examples`}>
                            {EXAMPLES.map(({ query: ex, desc }, i) => (
                                <button key={ex} type="button"
                                    role="option" id={optionId(i)} aria-selected={cursor === i} tabIndex={-1}
                                    className={`flex items-start gap-3 w-full px-3 py-2 text-left transition-colors ${cursor === i ? 'bg-muted' : 'hover:bg-muted/60'}`}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => { onQueryChange(ex); inputRef.current?.focus(); setCursor(-1); }}
                                >
                                    <code className="text-[11px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 shrink-0 mt-px">{ex}</code>
                                    <span className="text-[11px] text-muted-foreground leading-relaxed">{desc}</span>
                                </button>
                            ))}
                            </div>
                        </div>
                    )}
                </div>

                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="search-overlay-count">{announced}</div>

                <div className="px-3 py-1.5 border-t border-border flex gap-3 text-[10px] text-muted-foreground">
                    <span><kbd className="border border-border px-1 font-mono">↑↓</kbd> navigate</span>
                    <span><kbd className="border border-border px-1 font-mono">↵</kbd> select</span>
                    <span><kbd className="border border-border px-1 font-mono">Ctrl K</kbd> close</span>
                </div>
            </div>
        </>
    );
}

/** Ranges inside a part of a longer string, moved to that part's position in it. */
function shiftRanges(ranges: MatchRange[], by: number): MatchRange[] {
    return ranges.map(([from, to]) => [from + by, to + by]);
}

function ResultRow({ id, label, meta, labelRanges, metaRanges, groupQuery = '', tagQuery = '', folderColor, windowColor, groupName, chromeGroupName, chromeGroupColor, active, onMouseEnter, onClick }: {
    /** Option id: the search box points at the active row with `aria-activedescendant`. */
    id: string;
    label: string; meta: string; folderColor?: string; windowColor?: string;
    /** Where the search matched in `label` / `meta` (already worked out by the list). */
    labelRanges?: MatchRange[]; metaRanges?: MatchRange[];
    /** The `group:` / `tag:` filter text to mark in the group and Chrome-group badges. */
    groupQuery?: string; tagQuery?: string;
    groupName?: string; chromeGroupName?: string; chromeGroupColor?: string;
    active: boolean; onMouseEnter: () => void; onClick: () => void;
}) {
    return (
        <button type="button" role="option" id={id} aria-selected={active} tabIndex={-1}
            className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
            onMouseEnter={onMouseEnter} onClick={onClick}
        >
            {!groupName && windowColor && <AppWindow className="h-3.5 w-3.5 shrink-0" style={{ color: windowColor }} />}
            {!groupName && !windowColor && <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: folderColor ?? 'currentColor', fill: folderColor ?? 'currentColor' }} />}
            {groupName && (
                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 text-white leading-none" style={{ backgroundColor: folderColor }}>
                    <Highlighted text={groupName} ranges={matchRanges(groupName, groupQuery)} />
                </span>
            )}
            <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-medium truncate"><Highlighted text={label} ranges={labelRanges ?? []} /></span>
                {meta && <span className="block text-[10px] text-muted-foreground truncate"><Highlighted text={meta} ranges={metaRanges ?? []} /></span>}
            </span>
            {chromeGroupName && (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 text-white leading-none" style={{ backgroundColor: chromeGroupColor ?? '#888' }}>
                    <Highlighted text={chromeGroupName} ranges={matchRanges(chromeGroupName, tagQuery)} />
                </span>
            )}
        </button>
    );
}
