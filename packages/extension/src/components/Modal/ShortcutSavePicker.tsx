import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useGroups, useSaveShortcutTabs } from '@/hooks/useGroups';
import type { Tab } from '@/lib/types';

export const PENDING_SHORTCUT_SAVE_KEY = 'pendingShortcutSave';
const NEW_GROUP_VALUE = '__new__';

interface ShortcutSavePickerModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** Lets the user pick a destination group for tabs captured by a global keyboard shortcut. */
export function ShortcutSavePickerModal({ data, onClose }: ShortcutSavePickerModalProps) {
  const tabs = (data.tabs as Tab[]) ?? [];
  const { data: groupsState } = useGroups();
  const { mutate: saveTabs, isPending } = useSaveShortcutTabs();

  const groups = (groupsState?.available ?? []).filter((g) => !g.permanent && !g.archived);
  const [selected, setSelected] = useState<string>(groups[0]?.id ?? NEW_GROUP_VALUE);

  const clearPending = () => void chrome.storage.session.remove(PENDING_SHORTCUT_SAVE_KEY);

  const handleSave = () => {
    saveTabs({ tabs, groupId: selected === NEW_GROUP_VALUE ? undefined : selected });
    clearPending();
    onClose();
  };

  const handleCancel = () => {
    clearPending();
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save {tabs.length} tab{tabs.length === 1 ? '' : 's'}</DialogTitle>
        <DialogDescription>Choose where to save the tabs captured by the keyboard shortcut.</DialogDescription>
      </DialogHeader>

      <div className="py-4">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger aria-label="Destination group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_GROUP_VALUE}>Quick Save (new group)</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: g.color }}
                  />
                  {g.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={isPending || tabs.length === 0}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
