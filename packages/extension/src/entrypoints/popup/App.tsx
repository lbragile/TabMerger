import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { Header } from '@/components/Header';
import { SidePanel } from '@/components/SidePanel';
import { WindowsPanel } from '@/components/Windows';
import { ModalRoot } from '@/components/Modal';
import { AIGroupSuggestion } from '@/components/AIGroupSuggestion';
import { SelectionActionBar } from '@/components/SelectionActionBar';
import { useGroups } from '@/hooks/useGroups';
import { useCurrentTabs } from '@/hooks/useCurrentTabs';
import { getSetting } from '@/lib/localDb';
import { useSync } from '@/hooks/useSync';
import { useUIStore } from '@/stores/uiStore';
import { parseSearchQuery, fuzzyMatch } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { useTheme } from '@/hooks/useTheme';
import { useKeyboardNav } from '@/hooks/useKeyboardNav';
import { SubscriptionStatusBanner } from '@/components/SubscriptionStatusBanner';
import { UpgradeCTA } from '@/components/UpgradeCTA';
import { CleanupSuggestionBanner } from '@/components/CleanupSuggestionBanner';

function AppContent() {
  const { data: groupsState, isLoading } = useGroups();
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const searchFilter = useUIStore((s) => s.searchFilter);
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);

  // Apply saved theme (light/dark/system) before anything renders
  useTheme();

  useEffect(() => {
    if (sessionStorage.getItem('ext_opened')) return;
    sessionStorage.setItem('ext_opened', '1');
    trackEvent('extension_opened');
  }, []);

  // Restore last active group across popup re-opens
  useEffect(() => {
    if (!groupsState) return;
    getSetting('activeGroupIndex', 0).then((saved) => {
      // Clamp: if saved index no longer valid (group deleted), fall back to 0
      const clamped = saved < groupsState.available.length ? saved : 0;
      setActiveGroupIndex(clamped);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!groupsState]); // run once when groups first load

  useKeyboardNav({ groupCount: groupsState?.available.length ?? 0, focusedTabId: null });

  // Keep "Now Open" in sync with actual browser tabs
  useCurrentTabs();

  // Cloud sync (no-op if unauthenticated or free)
  useSync();

  // Auto-select group when "in:group_name" qualifier is typed
  useEffect(() => {
    if (!groupsState || !searchFilter) return;
    const { groupFilter } = parseSearchQuery(searchFilter);
    if (!groupFilter) return;
    const idx = groupsState.available.findIndex((g) =>
      fuzzyMatch(g.name, groupFilter)
    );
    if (idx !== -1) setActiveGroupIndex(idx);
  }, [searchFilter, groupsState, setActiveGroupIndex]);

  // Escape key exits selection mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionMode) {
        exitSelectionMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionMode, exitSelectionMode]);

  if (isLoading || !groupsState) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const activeGroup = groupsState.available[activeGroupIndex] ?? groupsState.available[0];
  const safeActiveIndex = groupsState.available.indexOf(activeGroup);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header />
      <SubscriptionStatusBanner />
      <UpgradeCTA />
      <CleanupSuggestionBanner />
      <AIGroupSuggestion />
      <div className="flex flex-1 min-h-0">
        <SidePanel groupsState={groupsState} />
        <main className="flex-1 min-w-0 overflow-hidden">
          {activeGroup ? (
            <WindowsPanel group={activeGroup} groupIndex={safeActiveIndex} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No group selected
            </div>
          )}
        </main>
      </div>
      {/* Floating action bar — visible when ≥1 item is selected */}
      {selectedItems.length > 0 && <SelectionActionBar />}
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <AppContent />
      <ModalRoot />
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            actionButton: 'toast-action-btn'
          }
        }}
      />
    </TooltipProvider>
  );
}
