import { useState, useCallback, useRef } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useTabSummary } from '@/hooks/useAI';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { Tab } from '@/lib/types';

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E";

async function fetchOgImage(tabId: number, url?: string): Promise<string | null> {
  let id = tabId > 0 ? tabId : 0;
  if (!id && url) {
    try {
      const matches = await chrome.tabs.query({ url });
      id = matches[0]?.id ?? 0;
    } catch { /* ignore */ }
  }
  if (!id) return null;
  try {
    const meta = await chrome.tabs.sendMessage(id, { type: 'GET_PAGE_META' });
    return (meta as { ogImage?: string | null })?.ogImage ?? null;
  } catch {
    return null;
  }
}

interface TabPreviewProps {
  tab: Tab;
  isLive?: boolean;
  children: React.ReactNode;
}

export function TabPreview({ tab, isLive, children }: TabPreviewProps) {
  const { aiFeatures } = useEntitlements();
  const { mutateAsync: fetchSummary } = useTabSummary();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ogImage, setOgImage] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const handleOpenChange = useCallback(async (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      fetchedRef.current = false;
      setOgImage(null);
      setSummary(null);
      setLoading(false);
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    const tabId = isLive ? (tab as Tab & { id?: number }).id ?? 0 : 0;
    try {
      if (!aiFeatures) {
        const img = tab.ogImage ?? await fetchOgImage(tabId, tab.url);
        setOgImage(img ?? null);
      } else {
        const [img, result] = await Promise.all([
          fetchOgImage(tabId, tab.url),
          fetchSummary({ url: tab.url, title: tab.title }),
        ]);
        setOgImage(tab.ogImage ?? img ?? null);
        setSummary(result.summary ?? null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [isLive, tab, aiFeatures, fetchSummary]);

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange} delayDuration={400}>
      <TooltipTrigger asChild>
        <span className="min-w-0 w-0 flex-1 overflow-hidden block">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="w-72 p-3 bg-popover text-popover-foreground border border-border shadow-md"
      >
        <div className="flex items-start gap-2">
          <img
            src={tab.favIconUrl || FALLBACK_FAVICON}
            alt=""
            className="mt-0.5 h-4 w-4 shrink-0"
            onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tab.title}</p>
            <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
            {loading ? (
              <Skeleton className="mt-2 h-24 w-full rounded" />
            ) : ogImage ? (
              <img
                src={ogImage}
                alt=""
                className="mt-2 w-full rounded object-cover max-h-32"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex');
                }}
              />
            ) : null}
            {!loading && (
              <div
                className="mt-2 h-24 w-full rounded bg-muted flex-col items-center justify-center gap-1 text-muted-foreground"
                style={{ display: ogImage ? 'none' : 'flex' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs opacity-40">No preview</span>
              </div>
            )}
            {aiFeatures && (
              loading ? (
                <div className="mt-2 space-y-1">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : summary ? (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{summary}</p>
              ) : null
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
