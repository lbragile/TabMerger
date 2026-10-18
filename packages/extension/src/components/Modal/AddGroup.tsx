import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ColorPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { rgbaToHex } from '@/lib/color';
import { useAddGroup, useGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';
import { asOneHistoryStep } from '@/lib/undoHistory';

interface AddGroupModalProps {
  onClose: () => void;
  /** Optional — set when this modal was opened from a "Create new group" move/copy menu item. */
  data?: Record<string, unknown>;
}

export function AddGroupModal({ onClose, data }: AddGroupModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(DEFAULT_GROUP_TITLE);
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  // Live Custom-picker preview, separate from the committed draft `color` — a drag/typing
  // tick must not itself become the new draft (Cancel needs something to revert to).
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  const displayColor = previewColor ?? color;
  const [pickerOpen, setPickerOpen] = useState(false);
  const { maxGroups, maxTabs } = useEntitlements();
  const { mutateAsync: addGroup, isPending } = useAddGroup({ maxGroups, maxTabs });
  const { data: groupsState } = useGroups();
  const onCreated = data?.onCreated as ((groupIndex: number) => void | Promise<unknown>) | undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // New group is always appended, so its index is the current length — capture before the mutation lands.
    const newIndex = groupsState?.available.length ?? 0;
    // Close once the group exists (a refused add, whose free-plan toast the backstop already
    // showed, keeps the dialog open). Opened from a "Create new group…" menu item, the add and the
    // caller's move/copy into the new group are ONE user action, so they are one undo step
    // (asOneHistoryStep): a single Undo removes the group and puts the item back. `mutateAsync`
    // settles even after this dialog unmounts, so the move still runs.
    void asOneHistoryStep(async () => {
      await addGroup({ name: name.trim() || DEFAULT_GROUP_TITLE, color });
      onClose();
      await onCreated?.(newIndex);
    }).catch(() => {});
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t('modals.addGroup.title')}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="group-name">{t('modals.addGroup.name')}</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('modals.addGroup.namePlaceholder')}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label id="group-color-label">{t('modals.addGroup.color')}</Label>
          {/* Same popover picker as the sidebar's group swatch, so both edit colours the same way. */}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-labelledby="group-color-label"
                className="gap-2 font-mono text-xs"
              >
                <span
                  data-testid="add-group-color-preview"
                  className="h-4 w-4 shrink-0 rounded-full border border-foreground/15"
                  style={{ backgroundColor: displayColor }}
                  aria-hidden="true"
                />
                {rgbaToHex(displayColor)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" side="bottom" align="start" sideOffset={4}>
              <ColorPicker
                value={color}
                onChange={(c) => {
                  setColor(c);
                  setPreviewColor(null);
                  setPickerOpen(false);
                }}
                onCancel={() => setPickerOpen(false)}
                onPreview={setPreviewColor}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('modals.addGroup.cancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {t('modals.addGroup.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
