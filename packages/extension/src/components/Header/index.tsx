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
import { Input } from "@/components/ui/input";
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
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAutoGroup } from "@/hooks/useAI";
import { useGroups, useSetGroupsState } from "@/hooks/useGroups";
import { useSessions, useSaveSession } from "@/hooks/useSessions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

    const { user, signOut } = useAuth();
    const { aiFeatures, tier, sessions: hasSessions } = useEntitlements();
    const { data: sessionList = [] } = useSessions();
    const { mutateAsync: saveSession } = useSaveSession();
    const { data: groupsState } = useGroups();
    const setGroupsState = useSetGroupsState();
    const { mutateAsync: autoGroup, isPending: aiLoading } = useAutoGroup();

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
        try {
            const result = await autoGroup(tabs);
            // Show suggestion — actual application handled by AIGroupSuggestion component
            toast.success(`AI suggested ${result.groups.length} groups`);
        } catch (err) {
            console.error("[TabMerger] AI grouping failed:", err);
        }
    };

    const handleSaveSession = async () => {
        const name = window.prompt('Session name:');
        if (!name?.trim()) return;
        try {
            await saveSession({ name: name.trim(), sessionCount: sessionList.length, hasSessions });
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
    };

    const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? "TM";
    const currentTierLabel = tierLabel(tier);

    return (
        <header className="grid grid-cols-[210px_1fr_auto] items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-zone-header">
            {/* Logo — pinned to the left */}
            <div className="flex items-center gap-1.5">
                <img
                    src={logoUrl}
                    alt="TabMerger"
                    className="h-5 w-5 rounded"
                />
                <span className="text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-[#00B4CC] to-[#F5921E]">
                    TabMerger
                </span>
            </div>

            {/* Search — centred in the middle column, capped at 360px */}
            <div className="flex justify-center">
                <Input
                    placeholder='Search… try in:"fitness journey" abs or tag:"study session"'
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="h-7 text-xs max-w-[360px] w-full"
                />
            </div>

            {/* Actions — pinned to the right */}
            <div className="flex items-center gap-0.5">
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

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7",
                                aiLoading && "animate-pulse",
                                !aiFeatures && "opacity-50",
                            )}
                            onClick={aiFeatures ? handleAIGroup : () => openModal('upgrade')}
                            disabled={aiLoading}
                            aria-label="AI Auto-group"
                        >
                            <Sparkles className={cn(
                                "h-3.5 w-3.5",
                                aiFeatures ? "text-purple-500" : "text-muted-foreground",
                            )} />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        {aiFeatures ? 'AI Auto-group' : 'Pro AI required — click to upgrade'}
                    </TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openModal("settings")}
                            aria-label="Settings"
                        >
                            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Settings</TooltipContent>
                </Tooltip>

                {/* Profile dropdown — consolidated sign-in / account widget */}
                <Tooltip>
                    <DropdownMenu>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <button className="ml-0.5 flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    {user ? (
                                        <Avatar className="h-6 w-6">
                                            <AvatarImage
                                                src={
                                                    user.user_metadata
                                                        ?.avatar_url as string
                                                }
                                            />
                                            <AvatarFallback className="text-[10px]">
                                                {userInitials}
                                            </AvatarFallback>
                                        </Avatar>
                                    ) : (
                                        <UserCircle className="h-5 w-5 text-muted-foreground" />
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
                                        className="text-xs text-destructive focus:text-destructive"
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
    );
}
