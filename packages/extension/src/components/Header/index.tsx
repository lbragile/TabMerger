import { useEffect, useRef, useState } from "react";
import {
    Undo2,
    Redo2,
    Settings,
    UserCircle,
    CheckSquare,
    Square,
    Zap,
    CircleQuestionMark,
    X,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/uiStore";
import { SearchOverlay } from './SearchOverlay';
import { LanguageMenu } from './LanguageMenu';
import { AiMenu } from './AiMenu';
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { AI_ENABLED } from "@/lib/aiFlag";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useGroups } from "@/hooks/useGroups";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { AIQuotaExceededPrompt } from "@/components/AIQuotaExceededPrompt";
import { TOUR_ANCHORS } from "@/lib/tourSteps";
import { useCloseOnOverlayDismiss } from "@/hooks/useCloseOnOverlayDismiss";
import { motionScrollBehavior } from "@/lib/reducedMotion";
import { useTranslation } from "react-i18next";
import { activeLocale } from "@/lib/i18n";
import { openInNewTab, websiteHomeUrl } from "@/lib/websiteLink";
import type { TFunction } from "i18next";

/** Map an internal tier key to a human-readable label. */
function tierLabel(tier: string, t: TFunction): string {
    if (tier === "pro_ai") return t("common.tier.proAi");
    if (tier === "pro") return t("common.tier.pro");
    return t("common.tier.free");
}

export function Header() {
    const { t } = useTranslation();
    const {
        searchFilter,
        setSearchFilter,
        openModal,
        selectionMode,
        toggleSelectionMode,
    } = useUIStore(
        useShallow((s) => ({
            searchFilter: s.searchFilter,
            setSearchFilter: s.setSearchFilter,
            openModal: s.openModal,
            selectionMode: s.selectionMode,
            toggleSelectionMode: s.toggleSelectionMode,
        })),
    );

    const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
    const setScrollToWindowIndex = useUIStore((s) => s.setScrollToWindowIndex);
    const startTour = useUIStore((s) => s.startTour);
    const handleStartTour = () => {
        trackEvent('tour_started', { source: 'header' });
        startTour();
    };
    // ponytail: fire once per non-empty search "session" — reset when the field clears
    const searchTrackedRef = useRef(false);
    const handleSearchQueryChange = (q: string) => {
        if (q && !searchTrackedRef.current) {
            searchTrackedRef.current = true;
            trackEvent('search_used');
        } else if (!q) {
            searchTrackedRef.current = false;
        }
        setSearchFilter(q);
    };
    const { user, signOut } = useAuth();
    const { tier } = useEntitlements();
    const { data: groupsState } = useGroups();
    const [aiQuotaExceeded, setAiQuotaExceeded] = useState(false);

    // Restores a snapshot as a NEW local change (see `useUndoRedo`), never the raw snapshot:
    // that one carries stale sync stamps, a stale copy of Now Open and no tour practice groups.
    const { canUndo, canRedo, undo: handleUndo, redo: handleRedo } = useUndoRedo();

    const searchRef = useRef<HTMLInputElement>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    // The guided tour closes whatever a step opened when it moves on (same signal as a multi-select)
    useCloseOnOverlayDismiss(() => setSearchOpen(false));

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setSearchOpen((o) => !o);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const openSearchRef = useRef<HTMLButtonElement>(null);
    const wasSearchOpen = useRef(false);
    useEffect(() => {
        // Focus the box in this effect, not in a later timer: the overlay's input is already
        // mounted here, and the effect of a click or Ctrl K runs before the next key is handled.
        // A timer lets keys typed straight after opening (busy main thread: the browser handles
        // queued input before timers) land on the opener instead of the box, and get lost.
        if (searchOpen) searchRef.current?.focus();
        // Closed (Escape, a click outside, Ctrl K, a picked result): the focused search box is
        // gone, so focus goes back to the opener. Not when something else already took it (a
        // picked tab focuses its row a moment later, which then moves it on).
        else if (wasSearchOpen.current) {
            const active = document.activeElement;
            if (!active || active === document.body) openSearchRef.current?.focus();
        }
        wasSearchOpen.current = searchOpen;
    }, [searchOpen]);

    // The query is only ever cleared by the user. This is the header's own clear (x) button:
    // it is about to unmount, so focus moves to the search box's opener first.
    const handleClearSearch = () => {
        openSearchRef.current?.focus();
        handleSearchQueryChange('');
    };

    // Picking a tab in the results goes to its group and KEEPS the query: the picked tab matches
    // it, so it is on screen and marked. Once the panel has drawn that group, the row is
    // scrolled into view and focused (the overlay that had focus is gone).
    const revealTab = (groupIndex: number, windowIndex: number, tabIndex: number) => {
        const selector = `[data-group-index="${groupIndex}"][data-window-index="${windowIndex}"][data-tab-index="${tabIndex}"]`;
        let tries = 0;
        const attempt = () => {
            const row = document.querySelector<HTMLElement>(selector);
            if (row) {
                row.scrollIntoView({ behavior: motionScrollBehavior(), block: 'nearest' });
                row.focus({ preventScroll: true });
            } else if (tries++ < 10) {
                setTimeout(attempt, 30);
            }
        };
        setTimeout(attempt, 0);
    };

    const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? "TM";
    const currentTierLabel = tierLabel(tier, t);
    // The site for this build (local, preview or public) in the popup's language; no link when
    // the build has no valid web app URL. Re-computed on every render, and useTranslation
    // re-renders on a language change, so the href follows the language picker.
    const websiteUrl = websiteHomeUrl(import.meta.env.VITE_WEB_APP_URL, activeLocale());
    const logo = (
        <>
            <img
                src={logoUrl}
                alt={t("common.appName")}
                className="h-5 w-5"
            />
            <span className="text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-[#00B4CC] to-[#F5921E]">
                {t("common.appName")}
            </span>
        </>
    );

    return (
        <>
        <header className="flex items-stretch border-b border-border shrink-0 bg-zone-header">
            {/* Logo — pinned to the left; width matches SidePanel exactly so the
                boundary below (sidebar/main split at 240px) lines up with this one. */}
            <div
                className="flex items-center gap-1.5 px-3 shrink-0"
                style={{ width: 240 }}
            >
                {/* Sized to its content, not the whole column: the rest of the cell stays a
                    neutral spot (the visual spec parks the pointer there). The outline offset
                    fits inside the cell's px-3, so the focus ring is never clipped. */}
                {websiteUrl ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <a
                                href={websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t("header.openWebsite")}
                                data-testid="header-logo-link"
                                className="flex items-center gap-1.5 min-w-0 transition-opacity motion-reduce:transition-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                onClick={(e) => openInNewTab(e, websiteUrl)}
                            >
                                {logo}
                            </a>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t("header.openWebsite")}</TooltipContent>
                    </Tooltip>
                ) : (
                    logo
                )}
            </div>

            {/* Search trigger — px-3 matches WindowsPanel toolbar's inset below it */}
            <div className="flex justify-start items-center flex-1 min-w-0 px-3 py-2">
                <button
                    ref={openSearchRef}
                    type="button"
                    className="flex items-center gap-2 h-7 px-3 max-w-[360px] w-full min-w-0 border border-border bg-muted/40 text-xs text-foreground/70 hover:bg-muted transition-colors"
                    onClick={() => setSearchOpen(true)}
                    // The visible query is part of the name (WCAG 2.5.3, label in name)
                    aria-label={searchFilter ? t('search.openSearchWithQuery', { query: searchFilter }) : t('search.openSearch')}
                    data-tour={TOUR_ANCHORS.search}
                >
                    <span dir={searchFilter ? 'auto' : undefined} className="flex-1 text-ui-start truncate">
                        {searchFilter || t('header.searchPlaceholder')}
                    </span>
                    <kbd className="text-[10px] border border-border px-1 py-px font-mono shrink-0">{t("common.shortcutSearch")}</kbd>
                </button>
                {/* A sibling of the opener (a button inside a button is invalid). Only while a
                    query is active: the query stays until the user clears it. */}
                {searchFilter && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 rounded-none border border-s-0 border-border"
                                onClick={handleClearSearch}
                                aria-label={t("search.clearSearch")}
                                data-testid="header-clear-search"
                                data-tour={TOUR_ANCHORS.searchClear}
                            >
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t("search.clearSearch")}</TooltipContent>
                    </Tooltip>
                )}
            </div>

            {/* Search overlay */}
            {searchOpen && <SearchOverlay
                query={searchFilter}
                onQueryChange={handleSearchQueryChange}
                groupsState={groupsState}
                // Picking a result never clears the query: it stays until the user clears it.
                onSelectGroup={(idx) => { setActiveGroupIndex(idx); setSearchOpen(false); }}
                onSelectWindow={(groupIdx, winIdx) => { setActiveGroupIndex(groupIdx); setScrollToWindowIndex(winIdx); setSearchOpen(false); }}
                onSelectTab={(groupIdx, winIdx, tabIdx) => { setActiveGroupIndex(groupIdx); setSearchOpen(false); revealTab(groupIdx, winIdx, tabIdx); }}
                onClose={() => setSearchOpen(false)}
                inputRef={searchRef}
            />}

            {/* Actions — pinned to the right */}
            <div className="flex items-center gap-0.5 pe-3 py-2 shrink-0">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => void handleUndo()}
                            disabled={!canUndo}
                            aria-label={t("header.undo")}
                            data-tour={TOUR_ANCHORS.undo}
                        >
                            <Undo2 className="h-3.5 w-3.5 text-muted-foreground rtl:-scale-x-100" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("header.undo")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => void handleRedo()}
                            disabled={!canRedo}
                            aria-label={t("header.redo")}
                            data-tour={TOUR_ANCHORS.redo}
                        >
                            <Redo2 className="h-3.5 w-3.5 text-muted-foreground rtl:-scale-x-100" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("header.redo")}</TooltipContent>
                </Tooltip>

                {/* Selection mode toggle */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7",
                                selectionMode &&
                                    "bg-accent text-accent-foreground",
                            )}
                            onClick={toggleSelectionMode}
                            aria-pressed={selectionMode}
                            data-tour={TOUR_ANCHORS.selectItems}
                            aria-label={
                                selectionMode
                                    ? t("header.exitSelectionMode")
                                    : t("header.selectItems")
                            }
                        >
                            {selectionMode ? (
                                <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            ) : (
                                <Square className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        {selectionMode ? t("header.exitSelectionMode") : t("header.selectItems")}
                    </TooltipContent>
                </Tooltip>

                {/* ✨ AI actions, sorted by scope (open tabs, selected group, all groups) */}
                <AiMenu onQuotaExceeded={setAiQuotaExceeded} />

                {/* Language: applies at once (Settings → General has the same choice) */}
                <LanguageMenu />

                {/* Replays the guided tour (components/Tour). The tour's last step points here. */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleStartTour}
                            aria-label={t("header.takeTour")}
                            data-tour={TOUR_ANCHORS.help}
                        >
                            <CircleQuestionMark className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("header.takeTour")}</TooltipContent>
                </Tooltip>

                {/* Profile dropdown — consolidated sign-in / account widget */}
                <Tooltip>
                    <DropdownMenu>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                {/* Same box as the icon buttons beside it, so the row is evenly spaced */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label={user ? t('header.accountMenu') : t('header.settingsMenu')}
                                    data-tour={TOUR_ANCHORS.accountMenu}
                                >
                                    {user ? (
                                        <Avatar className="h-5 w-5 ring-1 ring-border hover:ring-primary/60 transition-all">
                                            <AvatarImage
                                                src={
                                                    user.user_metadata
                                                        ?.avatar_url as string
                                                }
                                            />
                                            <AvatarFallback className="text-[10px] font-medium bg-primary/20 text-primary">
                                                {userInitials}
                                            </AvatarFallback>
                                        </Avatar>
                                    ) : (
                                        <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                </Button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>

                        <DropdownMenuContent
                            align="end"
                            className="w-44 text-xs"
                            data-tour={TOUR_ANCHORS.accountMenuContent}
                        >
                            {user ? (
                                <>
                                    {/* Account info */}
                                    <div className="px-2 py-1.5 space-y-1 pointer-events-none select-none">
                                        <p
                                            className="text-xs font-medium truncate"
                                            title={user.email ?? ""}
                                        >
                                            {user.email}
                                        </p>
                                        <Badge variant="secondary" className="text-xs px-2 py-0.5 mt-0.5">{currentTierLabel}</Badge>
                                    </div>
                                    <DropdownMenuSeparator />
                                    {tier === "free" && (
                                        <DropdownMenuItem
                                            className="text-xs text-primary focus:text-primary font-medium cursor-pointer"
                                            onClick={() =>
                                                chrome.tabs.create({
                                                    url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
                                                })
                                            }
                                        >
                                            <Zap className="h-3.5 w-3.5 me-2 shrink-0" />
                                            {t("header.upgradeToPro")}
                                        </DropdownMenuItem>
                                    )}
                                    {tier === "pro" && AI_ENABLED && (
                                        <DropdownMenuItem
                                            className="text-xs text-primary focus:text-primary font-medium cursor-pointer"
                                            onClick={() =>
                                                chrome.tabs.create({
                                                    url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
                                                })
                                            }
                                        >
                                            <Zap className="h-3.5 w-3.5 me-2 shrink-0" />
                                            {t("header.upgradeToProAi")}
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer"
                                        onClick={() => openModal("settings")}
                                        data-tour={TOUR_ANCHORS.menuSettings}
                                    >
                                        <Settings className="h-3.5 w-3.5 me-2 shrink-0" />
                                        {t("header.settings")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                                        onClick={() => void signOut()}
                                    >
                                        {t("header.signOut")}
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                <>
                                    {/* Not signed in — Upgrade hidden, sign-in only */}
                                    <div className="px-2 py-1.5 pointer-events-none select-none">
                                        <Badge variant="secondary" className="text-xs px-2 py-0.5">{t("common.tier.free")}</Badge>
                                    </div>
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer"
                                        onClick={() => openModal("settings")}
                                        data-tour={TOUR_ANCHORS.menuSettings}
                                    >
                                        <Settings className="h-3.5 w-3.5 me-2 shrink-0" />
                                        {t("header.settings")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-xs text-primary focus:text-primary font-medium"
                                        onClick={() => openModal("auth")}
                                    >
                                        <UserCircle className="h-3.5 w-3.5 me-2 shrink-0" />
                                        {t("header.signIn")}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </Tooltip>
            </div>
        </header>
        {aiQuotaExceeded && <AIQuotaExceededPrompt />}
        </>
    );
}
