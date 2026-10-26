import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGroups, useUpdateGroupName } from '@/hooks/useGroups';
import { cleanSuggestedName } from '@/lib/aiGroupName';
import { typedGroupName } from '@/lib/groupName';
import { toast } from '@/lib/toast';

interface NameGroupPickerModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** A suggestion's position, or the "type your own" option. */
type Choice = number | 'custom';

/** The modal data's suggestions, checked again (they were cleaned before opening; this is the trust boundary of the modal). */
function readSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(cleanSuggestedName).filter((name): name is string => name !== null);
}

/**
 * "Name this group" (opened by `useNameGroupAction` from the ✨ menu or the group's context menu):
 * the AI's suggestions as radio options, the first preselected, and a "type your own" box that
 * selects its own option as soon as the user types. Rename writes the chosen name through
 * `useUpdateGroupName` (one undo step, marked for sync) at the group's CURRENT position, found by
 * id: the group may have moved since the request. A typed name is checked like the sidebar's
 * inline rename (`typedGroupName`).
 *
 * Keyboard: the arrow keys move between the options (and into the box for "your own", whose up
 * and down arrows move back out); Enter renames; Escape closes (the dialog's own handling).
 */
export function NameGroupPickerModal({ data, onClose }: NameGroupPickerModalProps) {
  const { t } = useTranslation();
  const groupId = typeof data.groupId === 'string' ? data.groupId : '';
  const [suggestions] = useState(() => readSuggestions(data.suggestions));
  const { data: groupsState } = useGroups();
  const { mutateAsync: updateGroupName } = useUpdateGroupName();
  const [choice, setChoice] = useState<Choice>(suggestions.length > 0 ? 0 : 'custom');
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const radioName = useId();
  const customRadioId = useId();
  const radios = useRef<(HTMLInputElement | null)[]>([]);
  const customInput = useRef<HTMLInputElement>(null);

  const group = groupsState?.available.find((g) => g.id === groupId);
  const chosenName = choice === 'custom' ? typedGroupName(custom) : (suggestions[choice] ?? null);

  const submit = async () => {
    if (saving || !chosenName) return;
    const groupIndex = groupsState?.available.findIndex((g) => g.id === groupId) ?? -1;
    if (groupIndex < 0) {
      toast.info(t('errors.groupsChangedElsewhere'), { id: 'groups-changed-elsewhere' });
      onClose();
      return;
    }
    if (groupsState?.available[groupIndex].name === chosenName) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateGroupName({ groupIndex, name: chosenName });
      onClose();
    } catch (err) {
      console.error('[TabMerger] Name group rename failed:', err);
      toast.error(t('modals.nameGroup.renameFailed'));
      setSaving(false);
    }
  };

  /** Selects option `next` (wrapping) and focuses it: the box for "your own". */
  const moveTo = (next: number) => {
    const count = suggestions.length + 1;
    const index = ((next % count) + count) % count;
    if (index === suggestions.length) {
      setChoice('custom');
      customInput.current?.focus();
    } else {
      setChoice(index);
      radios.current[index]?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Enter') {
      // Enter renames from the options and the box; on a button it is that button's own click
      if (target.tagName === 'BUTTON') return;
      e.preventDefault();
      void submit();
      return;
    }
    const inBox = target === customInput.current;
    const isRadio = target instanceof HTMLInputElement && target.type === 'radio';
    if (!inBox && !isRadio) return;
    const rtl = getComputedStyle(target).direction === 'rtl';
    const step =
      e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowUp' ? -1
          // Left and right move the caret in the box; on the radios they follow the reading direction
          : !inBox && e.key === 'ArrowRight' ? (rtl ? -1 : 1)
            : !inBox && e.key === 'ArrowLeft' ? (rtl ? 1 : -1)
              : 0;
    if (step === 0) return;
    e.preventDefault();
    const from = inBox || target.id === customRadioId ? suggestions.length : Number(target.dataset.index);
    moveTo(from + step);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form className="flex min-w-0 flex-col gap-3" onSubmit={onSubmit} onKeyDown={onKeyDown}>
      <DialogHeader className="min-w-0">
        <DialogTitle>{t('modals.nameGroup.title')}</DialogTitle>
        <DialogDescription className="min-w-0 break-words">
          <Trans
            i18nKey="modals.nameGroup.current"
            values={{ name: group?.name ?? '' }}
            components={{ name: <bdi className="font-medium text-foreground" /> }}
          />
        </DialogDescription>
      </DialogHeader>

      <div role="radiogroup" aria-label={t('modals.nameGroup.choices')} className="flex min-w-0 flex-col gap-1">
        {suggestions.map((name, i) => (
          <label key={name} className="flex min-w-0 cursor-pointer items-start gap-2 px-1 py-0.5 text-sm hover:bg-accent/50">
            <input
              ref={(el) => { radios.current[i] = el; }}
              type="radio"
              name={radioName}
              data-index={i}
              checked={choice === i}
              tabIndex={choice === i ? 0 : -1}
              onChange={() => setChoice(i)}
              className="mt-1 shrink-0 accent-primary"
              data-testid="name-group-suggestion"
            />
            <span dir="auto" className="min-w-0 break-words text-start">{name}</span>
          </label>
        ))}
        <label htmlFor={customRadioId} className="flex min-w-0 cursor-pointer items-center gap-2 px-1 py-0.5 text-sm hover:bg-accent/50">
          <input
            id={customRadioId}
            type="radio"
            name={radioName}
            checked={choice === 'custom'}
            tabIndex={choice === 'custom' ? 0 : -1}
            onChange={() => { setChoice('custom'); customInput.current?.focus(); }}
            className="shrink-0 accent-primary"
            data-testid="name-group-custom-option"
          />
          <span className="min-w-0">{t('modals.nameGroup.custom')}</span>
        </label>
      </div>
      {/* The box sits outside the radiogroup (a radiogroup holds only radios), indented under its option */}
      <Input
        ref={customInput}
        dir={custom ? 'auto' : undefined}
        value={custom}
        onChange={(e) => { setCustom(e.target.value); setChoice('custom'); }}
        aria-label={t('modals.nameGroup.customInput')}
        className="ms-6 h-8 w-auto min-w-0 text-sm"
        data-testid="name-group-custom-input"
      />

      <div className="flex min-w-0 justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" className="text-xs" disabled={saving || !chosenName || !group} data-testid="name-group-rename">
          {t('modals.nameGroup.rename')}
        </Button>
      </div>
    </form>
  );
}
