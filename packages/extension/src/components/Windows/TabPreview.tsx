import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useTabPreview } from '@/hooks/useTabPreview';
import type { Tab } from '@/lib/types';

interface TabPreviewProps {
  tab: Tab;
  children: React.ReactNode;
}

export function TabPreview({ tab, children }: TabPreviewProps) {
  const { visible, summary, loading, handleMouseEnter, handleMouseLeave } = useTabPreview(
    tab.url,
    tab.title
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
        side="right"
        align="start"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex items-start gap-2">
          {tab.favIconUrl && (
            <img src={tab.favIconUrl} alt="" className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tab.title}</p>
            <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
            {loading ? (
              <div className="mt-2 space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ) : summary ? (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{summary}</p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
