import { useEffect, useRef, useState } from "react";
import {
    Undo2,
    Redo2,
    Settings,
    UserCircle,
    Sparkles,
    CheckSquare,
    Square,
    Zap,
    BookmarkPlus,
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
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAutoGroup, useOrganizeTabs, QuotaExceededError } from "@/hooks/useAI";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useGroups, useSetGroupsState, useApplyAIGroups } from "@/hooks/useGroups";
import { useSessions, useSaveSession } from "@/hooks/useSessions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import { AIQuotaExceededPrompt } from "@/components/AIQuotaExceededPrompt";

/** Map an internal tier key to a human-readable label. */
function tierLabel(tier: string): string {
    if (tier === "pro_ai") return "Pro AI";
    if (tier === "pro") return "Pro";
    return "Free tier";
}

export function Header() {
    const {
        searchFilter,
        setSearchFilter,
        openModal,
        undoStack,
        redoStack,
        undo,
        redo,
        selectionMode,
        toggleSelectionMode,
    } = useUIStore(
        useShallow((s) => ({
            searchFilter: s.searchFilter,
            setSearchFilter: s.setSearchFilter,
            openModal: s.openModal,
            undoStack: s.undoStack,
            redoStack: s.redoStack,
            undo: s.undo,
            redo: s.redo,
            selectionMode: s.selectionMode,
            toggleSelectionMode: s.toggleSelectionMode,
        })),
    );

    const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
    const setScrollToWindowIndex = useUIStore((s) => s.setScrollToWindowIndex);
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
    const { aiFeatures, tier, maxGroups, sessions: hasSessions } = useEntitlements();
    const { data: sessionList = [] } = useSessions();
    const { mutateAsync: saveSession } = useSaveSession();
    const { data: groupsState } = useGroups();
    const setGroupsState = useSetGroupsState();
    const { mutateAsync: autoGroup, isPending: aiLoading } = useAutoGroup();
    const { mutateAsync: applyAIGroups } = useApplyAIGroups();
    const { mutateAsync: organizeTabs, isPending: organizeLoading } = useOrganizeTabs();
    const { data: appSettings } = useAppSettings();
    const [aiQuotaExceeded, setAiQuotaExceeded] = useState(false);

    const handleUndo = async () => {
        if (!groupsState) return;
        const prev = undo(groupsState);
        if (prev) await setGroupsState(prev);
    };

    const handleRedo = async () => {
        if (!groupsState) return;
        const next = redo(groupsState);
        if (next) await setGroupsState(next);
    };

    const handleAIGroup = async () => {
        if (!groupsState) return;
        const tabs =
            groupsState.available[0]?.windows.flatMap((w) => w.tabs) ?? [];
        if (tabs.length === 0) {
            toast.error("No tabs open to group");
            return;
        }
        setAiQuotaExceeded(false);
        try {
            const result = await autoGroup(tabs);
            if (result.groups.length === 0) {
                toast.info("AI didn't find any groups to create");
                return;
            }

            // Cap to remaining free-tier group slots, same limit manual "New group" enforces
            const activeCount = groupsState.available.filter((g) => !g.permanent).length;
            const remaining = isFinite(maxGroups) ? Math.max(0, maxGroups - activeCount) : result.groups.length;
            const suggestions = result.groups.slice(0, remaining);
            if (suggestions.length === 0) {
                trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
                toast.error(`Free plan allows up to ${maxGroups} groups.`, {
                    action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
                });
                return;
            }

            const { appliedGroups } = await applyAIGroups(suggestions);
            if (appliedGroups === 0) {
                toast.info("No matching tabs found for AI's suggestion");
                return;
            }
            toast.success(`AI created ${appliedGroups} group${appliedGroups === 1 ? '' : 's'}`, {
                ...(suggestions.length < result.groups.length
                    ? { description: `${result.groups.length - suggestions.length} more suggested but skipped — free plan limit reached.` }
                    : {})
            });
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                setAiQuotaExceeded(true);
                return;
            }
            console.error("[TabMerger] AI grouping failed:", err);
            toast.error("AI grouping failed");
        }
    };

    // Kicks off the durable tab-organizer workflow server-side; the run itself streams
    // progress and asks for approval in the web dashboard's OrganizeProposal component
    // (packages/web/components/dashboard/OrganizeProposal.tsx), not here — the popup's
    // job is just to start it and hand off.
    const handleOrganize = async () => {
        setAiQuotaExceeded(false);
        try {
            await organizeTabs();
            toast.success('Organize started — review the proposal in your dashboard');
            chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/dashboard` });
        } catch (err) {
            if (err instanceof QuotaExceededError) {
                setAiQuotaExceeded(true);
                return;
            }
            toast.error(err instanceof Error ? err.message : 'Could not start organize');
        }
    };

    const handleSaveSession = () => {
        openModal('saveSession', {
            onSave: async (name: string, description?: string) => {
                try {
                    await saveSession({ name, description, sessionCount: sessionList.length, hasSessions });
                    toast.success('Session saved');
                } catch (err) {
                    if (err instanceof Error && err.message === 'SESSION_LIMIT') {
                        toast.error('Free plan allows up to 3 sessions.', {
                            action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
                        });
                    } else {
                        toast.error('Failed to save session');
                    }
                }
            }
        });
    };

    const searchRef = useRef<HTMLInputElement>(null);
    const [searchOpen, setSearchOpen] = useState(false);

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

    useEffect(() => {
        if (searchOpen) setTimeout(() => searchRef.current?.focus(), 0);
    }, [searchOpen]);

    const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? "TM";
    const currentTierLabel = tierLabel(tier);

    return (
        <>
        <header className="flex items-stretch border-b border-border shrink-0 bg-zone-header">
            {/* Logo — pinned to the left; width matches SidePanel exactly so the
                boundary below (sidebar/main split at 240px) lines up with this one. */}
            <div
                className="flex items-center gap-1.5 px-3 shrink-0"
                style={{ width: 240 }}
            >
                <img
                    src={logoUrl}
                    alt="TabMerger"
                    className="h-5 w-5"
                />
                <span className="text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-[#00B4CC] to-[#F5921E]">
                    TabMerger
                </span>
            </div>

            {/* Search trigger — px-3 matches WindowsPanel toolbar's inset below it */}
            <div className="flex justify-start items-center flex-1 min-w-0 px-3 py-2">
                <button
                    type="button"
                    className="flex items-center gap-2 h-7 px-3 max-w-[360px] w-full border border-border bg-muted/40 text-xs text-foreground/70 hover:bg-muted transition-colors"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Open search"
                >
                    <span className="flex-1 text-left truncate">
                        {searchFilter || 'Search tabs and groups…'}
                    </span>
                    <kbd className="text-[10px] border border-border px-1 py-px font-mono shrink-0">Ctrl K</kbd>
                </button>
            </div>

            {/* Search overlay */}
            {searchOpen && <SearchOverlay
                query={searchFilter}
                onQueryChange={handleSearchQueryChange}
                groupsState={groupsState}
                onSelectGroup={(idx) => { setActiveGroupIndex(idx); setSearchFilter(''); setSearchOpen(false); }}
                onSelectWindow={(groupIdx, winIdx) => { setActiveGroupIndex(groupIdx); setScrollToWindowIndex(winIdx); setSearchFilter(''); setSearchOpen(false); }}
                onClose={() => setSearchOpen(false)}
                inputRef={searchRef}
            />}

            {/* Actions — pinned to the right */}
            <div className="flex items-center gap-0.5 pr-3 py-2 shrink-0">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleSaveSession}
                            aria-label="Save session"
                        >
                            <BookmarkPlus className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Save session</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                            aria-label="Undo"
                        >
                            <Undo2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Undo</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0}
                            aria-label="Redo"
                        >
                            <Redo2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Redo</TooltipContent>
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
                            aria-label={
                                selectionMode
                                    ? "Exit selection mode"
                                    : "Select items"
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
                        {selectionMode ? "Exit selection mode" : "Select items"}
                    </TooltipContent>
                </Tooltip>

                <DropdownMenu>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        "h-7 w-7",
                                        (aiLoading || organizeLoading) && "animate-pulse",
                                        !aiFeatures && "opacity-50 cursor-not-allowed",
                                    )}
                                    onClick={aiFeatures ? undefined : () => openModal('upgrade')}
                                    disabled={aiLoading || organizeLoading}
                                    aria-disabled={!aiFeatures}
                                    aria-label="AI actions"
                                >
                                    <Sparkles className={cn(
                                        "h-3.5 w-3.5",
                                        aiFeatures ? "text-purple-500" : "text-muted-foreground",
                                    )} />
                                </Button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            {aiFeatures ? 'AI actions' : 'Pro AI required — click to upgrade'}
                        </TooltipContent>
                    </Tooltip>

                    {aiFeatures && (
                        <DropdownMenuContent align="end" className="w-52 text-xs">
                            {appSettings?.aiAutoGroupEnabled !== false && (
                                <DropdownMenuItem onClick={() => void handleAIGroup()}>
                                    <div>
                                        <div>Auto-group</div>
                                        <div className="text-[10px] text-muted-foreground font-normal">Group open tabs with AI</div>
                                    </div>
                                </DropdownMenuItem>
                            )}
                            {appSettings?.aiOrganizeEnabled !== false && (
                                <DropdownMenuItem onClick={() => void handleOrganize()}>
                                    <div>
                                        <div>Organize</div>
                                        <div className="text-[10px] text-muted-foreground font-normal">Reorganize all groups with AI</div>
                                    </div>
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    )}
                </DropdownMenu>

                {/* Profile dropdown — consolidated sign-in / account widget */}
                <Tooltip>
                    <DropdownMenu>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="ml-0.5 flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={user ? 'Account menu' : 'Settings menu'}
                                >
                                    {user ? (
                                        <Avatar className="h-6 w-6 ring-1 ring-border hover:ring-primary/60 transition-all">
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
                                        <UserCircle className="h-5 w-5 text-foreground/70 hover:text-foreground transition-colors" />
                                    )}
                                </button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>

                        <DropdownMenuContent
                            align="end"
                            className="w-44 text-xs"
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
                                            <Zap className="h-3.5 w-3.5 mr-2 shrink-0" />
                                            Upgrade to Pro
                                        </DropdownMenuItem>
                                    )}
                                    {tier === "pro" && (
                                        <DropdownMenuItem
                                            className="text-xs text-primary focus:text-primary font-medium cursor-pointer"
                                            onClick={() =>
                                                chrome.tabs.create({
                                                    url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
                                                })
                                            }
                                        >
                                            <Zap className="h-3.5 w-3.5 mr-2 shrink-0" />
                                            Upgrade to Pro AI
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer"
                                        onClick={() => openModal("settings")}
                                    >
                                        <Settings className="h-3.5 w-3.5 mr-2 shrink-0" />
                                        Settings
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                                        onClick={() => void signOut()}
                                    >
                                        Sign out
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                <>
                                    {/* Not signed in — Upgrade hidden, sign-in only */}
                                    <div className="px-2 py-1.5 pointer-events-none select-none">
                                        <Badge variant="secondary" className="text-xs px-2 py-0.5">Free tier</Badge>
                                    </div>
                                    <DropdownMenuItem
                                        className="text-xs cursor-pointer"
                                        onClick={() => openModal("settings")}
                                    >
                                        <Settings className="h-3.5 w-3.5 mr-2 shrink-0" />
                                        Settings
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-xs text-primary focus:text-primary font-medium"
                                        onClick={() => openModal("auth")}
                                    >
                                        <UserCircle className="h-3.5 w-3.5 mr-2 shrink-0" />
                                        Sign in
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
