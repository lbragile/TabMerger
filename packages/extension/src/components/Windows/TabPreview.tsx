import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useTabPreview } from '@/hooks/useTabPreview';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { Tab } from '@/lib/types';

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E";

interface TabPreviewProps {
  tab: Tab;
  children: React.ReactNode;
}

export function TabPreview({ tab, children }: TabPreviewProps) {
  const { aiFeatures } = useEntitlements();
  const { visible, summary, ogImage, loading, handleMouseEnter, handleMouseLeave } = useTabPreview(
    tab.url,
    tab.title,
    aiFeatures,
    tab.id,
    tab.ogImage
  );

  return (
    <Popover open={visible}>
      <PopoverTrigger asChild>
        <span
          className="truncate"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        side="top"
        align="start"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
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
            {/* OG image — shown for all users while live tab is hovered */}
            {loading ? (
              <Skeleton className="mt-2 h-24 w-full rounded" />
            ) : ogImage ? (
              <img
                src={ogImage}
                alt=""
                className="mt-2 w-full rounded object-cover max-h-32"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : null}
            {/* AI summary section — only rendered for Pro AI users */}
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
      </PopoverContent>
    </Popover>
  );
}
