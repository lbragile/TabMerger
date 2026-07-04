import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { Header } from '@/components/Header';
import { SidePanel } from '@/components/SidePanel';
import { WindowsPanel } from '@/components/Windows';
import { ModalRoot } from '@/components/Modal';
import { AIGroupSuggestion } from '@/components/AIGroupSuggestion';
import { useGroups } from '@/hooks/useGroups';
import { useCurrentTabs } from '@/hooks/useCurrentTabs';
import { useSync } from '@/hooks/useSync';
import { useUIStore } from '@/stores/uiStore';

function AppContent() {
  const { data: groupsState, isLoading } = useGroups();
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);

  // Keep "Now Open" in sync with actual browser tabs
  useCurrentTabs();

  // Cloud sync (no-op if unauthenticated or free)
  useSync();

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
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <AppContent />
      <ModalRoot />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
