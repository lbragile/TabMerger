import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Star,
  EyeOff,
  MoreHorizontal,
  Trash2,
  Edit3,
  ShieldOff,
  Shield,
  GripVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { TabItem } from './Tab';
import type { Window as WindowType } from '@/lib/types';
import {
  useDeleteWindow,
  useUpdateWindowName,
  useToggleWindowStarred,
  useToggleWindowIncognito
} from '@/hooks/useGroups';
import { cn } from '@/lib/utils';

interface WindowProps {
  window: WindowType;
  groupIndex: number;
  windowIndex: number;
  searchFilter?: string;
}

export function WindowItem({ window, groupIndex, windowIndex, searchFilter }: WindowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `window-${groupIndex}-${windowIndex}`
  });

  const [isEditing, setIsEditing] = useState(false);
  const [nameValue, setNameValue] = useState(window.name ?? 'Window');

  const { mutate: deleteWindow } = useDeleteWindow();
  const { mutate: updateWindowName } = useUpdateWindowName();
  const { mutate: toggleStarred } = useToggleWindowStarred();
  const { mutate: toggleIncognito } = useToggleWindowIncognito();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(window.starred ? { borderLeftColor: 'hsl(var(--primary))' } : {})
  };

  const handleRename = () => {
    if (nameValue.trim()) {
      updateWindowName({ groupIndex, windowIndex, name: nameValue.trim() });
    }
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border border-border bg-card mb-2',
        isDragging && 'opacity-50 shadow-lg',
        window.starred && 'border-l-2',
        window.incognito && 'bg-muted/30'
      )}
    >
      {/* Window header */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/50">
        <span
          className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {isEditing ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="flex-1 text-xs bg-transparent border-b border-primary outline-none"
          />
        ) : (
          <span
            className="flex-1 text-xs font-medium truncate cursor-default"
            onDoubleClick={() => setIsEditing(true)}
          >
            {window.name ?? 'Window'}
          </span>
        )}

        {window.incognito && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            <EyeOff className="h-2.5 w-2.5 mr-0.5" />
            incognito
          </Badge>
        )}

        <span className="text-[10px] text-muted-foreground">
          {window.tabs.length} {window.tabs.length === 1 ? 'tab' : 'tabs'}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className={cn('h-5 w-5 rounded', window.starred && 'text-yellow-500')}
          onClick={() => toggleStarred({ groupIndex, windowIndex })}
          title={window.starred ? 'Unstar window' : 'Star window'}
        >
          <Star className="h-3 w-3" fill={window.starred ? 'currentColor' : 'none'} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5 rounded">
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onClick={() => setIsEditing(true)}>
              <Edit3 className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleIncognito({ groupIndex, windowIndex })}>
              {window.incognito ? (
                <>
                  <Shield className="h-3.5 w-3.5 mr-2" />
                  Remove incognito
                </>
              ) : (
                <>
                  <ShieldOff className="h-3.5 w-3.5 mr-2" />
                  Mark incognito
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteWindow({ groupIndex, windowIndex })}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete window
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tabs list — DndContext is in parent WindowsPanel */}
      <div className="py-0.5">
        {window.tabs.map((tab, tabIndex) => (
          <TabItem
            key={`${tab.id}-${tabIndex}`}
            tab={tab}
            groupIndex={groupIndex}
            windowIndex={windowIndex}
            tabIndex={tabIndex}
            searchFilter={searchFilter}
          />
        ))}
        {window.tabs.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-muted-foreground italic">Empty window</p>
        )}
      </div>
    </div>
  );
}
