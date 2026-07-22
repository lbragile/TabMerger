import { useEffect, useRef, useState } from 'react';
import { Search, Folder, AppWindow } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { parseSearchQuery } from '@/lib/utils';
import type { GroupsState } from '@/lib/types';

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
    | { kind: 'window'; label: string; meta: string; groupIndex: number; windowIndex: number; color: string }
    | { kind: 'tab'; label: string; meta: string; groupIndex: number; groupColor: string; chromeGroup?: { name: string; color: string } };

/**
 * Converts a search query into a flat list of matching group and tab results.
 * Delegates keyword parsing (`in:`, `tag:`) to `parseSearchQuery`, then filters
 * groups and tabs accordingly. Groups are surfaced directly only when the query
 * is a pure group-name search; otherwise individual matching tabs are returned.
 */
function getResults(query: string, groupsState: GroupsState | undefined): Result[] {
    if (!groupsState || !query.trim()) return [];
    const { groupFilter, windowFilter, tagFilter, tabQuery } = parseSearchQuery(query);
    const results: Result[] = [];

    groupsState.available.forEach((group, groupIndex) => {
        if (groupFilter && !group.name.toLowerCase().includes(groupFilter.toLowerCase())) return;
        const tabCount = group.windows.reduce((a, w) => a + w.tabs.length, 0);

        if (groupFilter && !tabQuery && !tagFilter && !windowFilter) {
            group.windows.forEach((win, windowIndex) => {
                results.push({ kind: 'window', label: win.name ?? 'Window', meta: `${win.tabs.length} tab${win.tabs.length !== 1 ? 's' : ''} · ${group.name}`, groupIndex, windowIndex, color: group.color });
            });
            return;
        }

        group.windows.forEach((win, windowIndex) => {
            if (windowFilter && !win.name?.toLowerCase().includes(windowFilter.toLowerCase())) return;

            win.tabs.forEach((tab) => {
                const titleMatch = !tabQuery || tab.title?.toLowerCase().includes(tabQuery.toLowerCase()) || tab.url?.toLowerCase().includes(tabQuery.toLowerCase());
                const tagMatch = !tagFilter || tab.chromeGroup?.name.toLowerCase().includes(tagFilter.toLowerCase()) || tab.title?.toLowerCase().includes(tagFilter.toLowerCase());
                if (titleMatch && tagMatch) {
                    results.push({ kind: 'tab', label: tab.title || tab.url || 'Untitled', meta: group.name, groupIndex, groupColor: group.color, chromeGroup: tab.chromeGroup });
                }
            });
        });

        // Surface group by name only if the plain query actually matches it
        if (!tabQuery && !tagFilter && !groupFilter && !windowFilter && group.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({ kind: 'group', label: group.name, meta: `${group.windows.length} windows · ${tabCount} tabs`, groupIndex, color: group.color });
        }
    });

    return results.slice(0, 12);
}

/**
 * Returns saved groups whose names contain `typed`, used to populate the `group:` picker.
 * Excludes the permanent "Now Open" group since it cannot be targeted by a saved-group search.
 */
function getGroupPicks(typed: string, groupsState: GroupsState | undefined) {
    if (!groupsState) return [];
    return groupsState.available
        .filter((g) => !g.permanent && g.name.toLowerCase().includes(typed.toLowerCase()))
        .map((g) => ({ name: g.name, color: g.color, index: groupsState.available.indexOf(g) }))
        .slice(0, 8);
}

/**
 * Returns all windows across all groups whose names contain `typed`, used to populate the `window:` picker.
 * Each entry includes the group color for visual association and a `windowIndex` for navigation.
 */
function getWindowPicks(typed: string, groupsState: GroupsState | undefined, groupFilter: string): Array<{ name: string; color: string; index?: number; windowIndex: number; groupIndex: number }> {
    if (!groupsState) return [];
    const picks: Array<{ name: string; color: string; index?: number; windowIndex: number; groupIndex: number }> = [];
    groupsState.available.forEach((g, groupIndex) => {
        if (groupFilter && !g.name.toLowerCase().includes(groupFilter.toLowerCase())) return;
        g.windows.forEach((w, windowIndex) => {
            if (!w.name || !w.name.toLowerCase().includes(typed.toLowerCase())) return;
            picks.push({ name: w.name, color: g.color, windowIndex, groupIndex });
        });
    });
    return picks.slice(0, 8);
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
        g.windows.forEach((w) => {
            w.tabs.forEach((t) => {
                if (t.chromeGroup && !seen.has(t.chromeGroup.name) && t.chromeGroup.name.toLowerCase().includes(typed.toLowerCase())) {
                    seen.add(t.chromeGroup.name);
                    picks.push({ name: t.chromeGroup.name, color: t.chromeGroup.color });
                }
            });
        });
    });
    return picks.slice(0, 8);
}

interface Props {
    query: string;
    onQueryChange: (q: string) => void;
    groupsState: GroupsState | undefined;
    onSelectGroup: (index: number) => void;
    onSelectWindow: (groupIndex: number, windowIndex: number) => void;
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
export function SearchOverlay({ query, onQueryChange, groupsState, onSelectGroup, onSelectWindow, onClose, inputRef }: Props) {
    const [cursor, setCursor] = useState(-1);
    // Suppresses results for one render cycle after a picker selection completes.
    // Without this, the render that transitions from picker→results mode can show
    // stale group data before the query fully settles.
    const [isPicking, setIsPicking] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    const pickerCtx = getPickerContext(query);
    const groupPicks  = pickerCtx?.prefix === 'group:'  ? getGroupPicks(pickerCtx.typed, groupsState)  : [];
    const windowPicks = pickerCtx?.prefix === 'window:' ? getWindowPicks(pickerCtx.typed, groupsState, parseSearchQuery(pickerCtx.before).groupFilter) : [];
    const tagPicks    = pickerCtx?.prefix === 'tag:'    ? getTagPicks(pickerCtx.typed, groupsState)    : [];
    const pickerItems: Array<{ name: string; color: string; index?: number; windowIndex?: number; groupIndex?: number }> =
        pickerCtx?.prefix === 'group:'  ? groupPicks  :
        pickerCtx?.prefix === 'window:' ? windowPicks :
        pickerCtx?.prefix === 'tag:'    ? tagPicks    : [];
    const inPicker = pickerCtx !== null;

    const results = (inPicker || isPicking) ? [] : getResults(query, groupsState);
    const listLength = inPicker ? pickerItems.length : (query.trim() ? results.length : EXAMPLES.length);

    useEffect(() => { setCursor(-1); setIsPicking(false); }, [query]);

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
                    else onSelectGroup(r.groupIndex);
                } else if (!query.trim() && EXAMPLES[cursor]) {
                    onQueryChange(EXAMPLES[cursor].query);
                    inputRef.current?.focus();
                    setCursor(-1);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cursor, listLength, inPicker, pickerItems, pickerCtx, results, query, onSelectGroup, onSelectWindow, onQueryChange, inputRef]);

    /**
     * Completes a picker selection by replacing the bare `in:WORD` / `tag:WORD` at the
     * end of the query with the quoted form `in:"Selected Name" `, then refocuses the
     * input so the user can continue typing a tab keyword (e.g. `in:"Work" report`).
     * Both the query update and refocus are deferred via setTimeout(0) so they run after
     * the click event fully settles — prevents the stale-render that showed wrong results.
     */
    function completePick(name: string, _groupIndex?: number) {
        const newQuery = `${pickerCtx?.before ?? ''}${pickerCtx?.prefix}"${name}" `;
        setCursor(-1);
        setIsPicking(true);
        // Defer so the click event (and any blur/focus side-effects) fully settle before
        // the query update triggers a results re-render.
        setTimeout(() => {
            onQueryChange(newQuery);
            inputRef.current?.focus();
        }, 0);
    }

    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed left-1/2 -translate-x-1/2 z-50 w-[440px] rounded-none border border-border bg-popover shadow-2xl overflow-hidden"
                style={{ top: '8px' }}
            >
                {/* Input row */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                        ref={inputRef}
                        placeholder="Search tabs, groups…"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        className="h-7 text-sm border-0 shadow-none focus-visible:ring-0 p-0 bg-transparent"
                    />
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
                            ) : pickerItems.map((item, i) => (
                                <button
                                    key={`${item.name}-${i}`}
                                    type="button"
                                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${cursor === i ? 'bg-muted' : 'hover:bg-muted/60'}`}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => completePick(item.name, item.index)}
                                >
                                    {pickerCtx.prefix === 'window:'
                                        ? <AppWindow className="h-3.5 w-3.5 shrink-0" style={{ color: item.color }} />
                                        : <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: item.color, fill: item.color }} />
                                    }
                                    <span className="text-[12px] font-medium">{item.name}</span>
                                </button>
                            ))}
                        </div>
                    ) : query.trim() ? (
                        /* Search results */
                        results.length === 0 ? (
                            <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">No matches for "{query}"</p>
                        ) : (
                            <>
                                {results.filter((r) => r.kind === 'group').length > 0 && (
                                    <div>
                                        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Groups</p>
                                        {results.filter((r) => r.kind === 'group').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            return <ResultRow key={`g${i}`} label={r.label} meta={r.meta}
                                                folderColor={r.kind === 'group' ? r.color : undefined}
                                                active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => onSelectGroup(r.groupIndex)} />;
                                        })}
                                    </div>
                                )}
                                {results.filter((r) => r.kind === 'window').length > 0 && (
                                    <div>
                                        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Windows</p>
                                        {results.filter((r) => r.kind === 'window').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            return <ResultRow key={`w${i}`} label={r.label} meta={r.kind === 'window' ? r.meta : ''}
                                                windowColor={r.kind === 'window' ? r.color : undefined}
                                                active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => { if (r.kind === 'window') { onQueryChange(`${query.trimEnd()} window:"${r.label}" `); inputRef.current?.focus(); setCursor(-1); } }} />;
                                        })}
                                    </div>
                                )}
                                {results.filter((r) => r.kind === 'tab').length > 0 && (
                                    <div>
                                        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tabs</p>
                                        {results.filter((r) => r.kind === 'tab').map((r, i) => {
                                            const ri = results.indexOf(r);
                                            return <ResultRow key={`t${i}`} label={r.label} meta=""
                                                folderColor={r.kind === 'tab' ? r.groupColor : undefined}
                                                groupName={r.kind === 'tab' ? r.meta : undefined}
                                                chromeGroupName={r.kind === 'tab' ? r.chromeGroup?.name : undefined}
                                                chromeGroupColor={r.kind === 'tab' ? r.chromeGroup?.color : undefined}
                                                active={cursor === ri} onMouseEnter={() => setCursor(ri)}
                                                onClick={() => onSelectGroup(r.groupIndex)} />;
                                        })}
                                    </div>
                                )}
                            </>
                        )
                    ) : (
                        /* Empty state — examples */
                        <div>
                            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Try these searches</p>
                            {EXAMPLES.map(({ query: ex, desc }, i) => (
                                <button key={ex} type="button"
                                    className={`flex items-start gap-3 w-full px-3 py-2 text-left transition-colors ${cursor === i ? 'bg-muted' : 'hover:bg-muted/60'}`}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => { onQueryChange(ex); inputRef.current?.focus(); setCursor(-1); }}
                                >
                                    <code className="text-[11px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 shrink-0 mt-px">{ex}</code>
                                    <span className="text-[11px] text-muted-foreground leading-relaxed">{desc}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="px-3 py-1.5 border-t border-border flex gap-3 text-[10px] text-muted-foreground">
                    <span><kbd className="border border-border px-1 font-mono">↑↓</kbd> navigate</span>
                    <span><kbd className="border border-border px-1 font-mono">↵</kbd> select</span>
                    <span><kbd className="border border-border px-1 font-mono">Ctrl K</kbd> close</span>
                </div>
            </div>
        </>
    );
}

function ResultRow({ label, meta, folderColor, windowColor, groupName, chromeGroupName, chromeGroupColor, active, onMouseEnter, onClick }: {
    label: string; meta: string; folderColor?: string; windowColor?: string;
    groupName?: string; chromeGroupName?: string; chromeGroupColor?: string;
    active: boolean; onMouseEnter: () => void; onClick: () => void;
}) {
    return (
        <button type="button"
            className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
            onMouseEnter={onMouseEnter} onClick={onClick}
        >
            {!groupName && windowColor && <AppWindow className="h-3.5 w-3.5 shrink-0" style={{ color: windowColor }} />}
            {!groupName && !windowColor && <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: folderColor ?? 'currentColor', fill: folderColor ?? 'currentColor' }} />}
            {groupName && (
                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 text-white leading-none" style={{ backgroundColor: folderColor }}>
                    {groupName}
                </span>
            )}
            <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-medium truncate">{label}</span>
                {meta && <span className="block text-[10px] text-muted-foreground truncate">{meta}</span>}
            </span>
            {chromeGroupName && (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 text-white leading-none" style={{ backgroundColor: chromeGroupColor ?? '#888' }}>
                    {chromeGroupName}
                </span>
            )}
        </button>
    );
}
