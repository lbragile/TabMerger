import { Undo2, Redo2, Download, Upload, Settings, UserCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/uiStore';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/hooks/useAuth';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAutoGroup } from '@/hooks/useAI';
import { useGroups, useSetGroupsState } from '@/hooks/useGroups';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** Map an internal tier key to a human-readable label. */
function tierLabel(tier: string): string {
  if (tier === 'pro_ai') return 'Pro + AI';
  if (tier === 'pro') return 'Pro';
  return 'Free plan';
}

export function Header() {
  const { searchFilter, setSearchFilter, openModal, undoStack, redoStack, undo, redo } =
    useUIStore(useShallow((s) => ({
      searchFilter: s.searchFilter,
      setSearchFilter: s.setSearchFilter,
      openModal: s.openModal,
      undoStack: s.undoStack,
      redoStack: s.redoStack,
      undo: s.undo,
      redo: s.redo
    })));

  const { user, signOut } = useAuth();
  const { aiFeatures, tier } = useEntitlements();
  const { data: groupsState } = useGroups();
  const setGroupsState = useSetGroupsState();
  const { mutateAsync: autoGroup, isPending: aiLoading } = useAutoGroup();

  const handleUndo = async () => {
    const prev = undo();
    if (prev) {
      await setGroupsState(prev);
    }
  };

  const handleRedo = async () => {
    const next = redo();
    if (next) {
      await setGroupsState(next);
    }
  };

  const handleAIGroup = async () => {
    if (!groupsState) return;
    const tabs = groupsState.available[0]?.windows.flatMap((w) => w.tabs) ?? [];
    if (tabs.length === 0) {
      toast.error('No tabs open to group');
      return;
    }
    try {
      const result = await autoGroup(tabs);
      // Show suggestion — actual application handled by AIGroupSuggestion component
      toast.success(`AI suggested ${result.groups.length} groups`);
    } catch (err) {
      toast.error('AI grouping failed');
    }
  };

  const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? 'TM';
  const currentTierLabel = tierLabel(tier);

  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-background">
      {/* Logo */}
      <div className="flex items-center gap-1.5 shrink-0">
        <img
          src="/images/logo16.png"
          alt="TabMerger"
          className="h-5 w-5"
        />
        <span className="text-sm font-semibold">TabMerger</span>
      </div>

      {/* Search */}
      <Input
        placeholder="Search tabs..."
        value={searchFilter}
        onChange={(e) => setSearchFilter(e.target.value)}
        className="h-7 text-xs flex-1 min-w-0"
      />

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
            >
              <Undo2 className="h-3.5 w-3.5" />
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
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Redo</TooltipContent>
        </Tooltip>

        {aiFeatures && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', aiLoading && 'animate-pulse')}
                onClick={handleAIGroup}
                disabled={aiLoading}
                title="AI Group"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">AI Auto-group</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => openModal('importExport', { mode: 'export' })}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Export</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => openModal('importExport', { mode: 'import' })}
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Import</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => openModal('settings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Settings</TooltipContent>
        </Tooltip>

        {/* Profile dropdown — consolidated sign-in / account widget */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-0.5 flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {user ? (
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user.user_metadata?.avatar_url as string} />
                  <AvatarFallback className="text-[10px]">{userInitials}</AvatarFallback>
                </Avatar>
              ) : (
                <UserCircle className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-44 text-xs">
            {user ? (
              <>
                {/* Account info */}
                <div className="px-2 py-1.5 space-y-1">
                  <p className="text-xs font-medium truncate" title={user.email ?? ''}>
                    {user.email}
                  </p>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {currentTierLabel}
                  </Badge>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => openModal('settings')}
                >
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs text-destructive focus:text-destructive"
                  onClick={() => void signOut()}
                >
                  Sign out
                </DropdownMenuItem>
              </>
            ) : (
              <>
                {/* Not signed in */}
                <div className="px-2 py-1.5">
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    Free plan
                  </Badge>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => openModal('auth')}
                >
                  Sign in
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
