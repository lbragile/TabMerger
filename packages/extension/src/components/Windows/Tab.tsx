import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TabPreview } from './TabPreview';
import type { Tab as TabType } from '@/lib/types';
import { useDeleteTab } from '@/hooks/useGroups';
import { cn } from '@/lib/utils';

interface TabItemProps {
  tab: TabType;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
  searchFilter?: string;
}

export function TabItem({ tab, groupIndex, windowIndex, tabIndex, searchFilter }: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `tab-${groupIndex}-${windowIndex}-${tabIndex}`
  });
  const { mutate: deleteTab } = useDeleteTab();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const handleOpen = () => {
    if (tab.url) {
      chrome.tabs.create({ url: tab.url, active: true });
    }
  };

  const isHighlighted =
    searchFilter &&
    (tab.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      tab.url.toLowerCase().includes(searchFilter.toLowerCase()));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-accent/50 cursor-pointer',
        isDragging && 'opacity-50 bg-accent',
        searchFilter && !isHighlighted && 'opacity-30'
      )}
      {...attributes}
      {...listeners}
    >
      {tab.favIconUrl ? (
        <img
          src={tab.favIconUrl}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-sm"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="h-3.5 w-3.5 shrink-0 rounded-sm bg-muted" />
      )}

      <TabPreview tab={tab}>
        <span
          className="flex-1 truncate text-xs leading-5 hover:underline"
          onClick={handleOpen}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {tab.title || tab.url}
        </span>
      </TabPreview>

      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          deleteTab({ groupIndex, windowIndex, tabIndex });
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Remove tab"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
