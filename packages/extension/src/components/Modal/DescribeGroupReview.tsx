import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useGroups } from '@/hooks/useGroups';
import { useSaveNote } from '@/hooks/useDescribeGroupAction';
import { GROUP_NOTE_MAX_LENGTH, WINDOW_NOTE_MAX_LENGTH, appendDescription, canAppendDescription } from '@/lib/groupDescription';
import { readAiTarget, resolveAiTarget } from '@/lib/aiTarget';
import { toast } from '@/lib/toast';

interface DescribeGroupReviewModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/**
 * "Describe" for a group or window that already has a note (opened by `useDescribeAction`): shows
 * the current note and the AI's suggestion, and offers Replace note, Add below (the note, a blank
 * line, the suggestion; offered only while the result fits that note editor's limit) and Cancel.
 * Either choice is one undo step through the normal group or window note write, so the note syncs
 * (encrypted) like any edit. The target is read live (`resolveAiTarget`: a group by id, a window by
 * position and its tabs): the note shown is the one a choice would change, and a window that is
 * gone or changed disables both writes.
 */
export function DescribeGroupReviewModal({ data, onClose }: DescribeGroupReviewModalProps) {
  const { t } = useTranslation();
  const [target] = useState(() => readAiTarget(data));
  const description = typeof data.description === 'string' ? data.description : '';
  const { data: groupsState } = useGroups();
  const saveNote = useSaveNote();
  const [saving, setSaving] = useState(false);

  const found = resolveAiTarget(groupsState, target);
  const isWindow = target?.kind === 'window';
  const note = found?.note ?? '';
  const max = isWindow ? WINDOW_NOTE_MAX_LENGTH : GROUP_NOTE_MAX_LENGTH;
  const canAppend = canAppendDescription(note, description, max);

  const choose = async (next: string, message: string) => {
    if (!target) return;
    setSaving(true);
    try {
      await saveNote(target, next, message);
      onClose();
    } catch (err) {
      console.error('[TabMerger] Describe group note write failed:', err);
      toast.error(t('modals.describeGroup.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DialogHeader className="min-w-0">
        <DialogTitle>{t('modals.describeGroup.title')}</DialogTitle>
        <DialogDescription>{isWindow ? t('modals.describeGroup.descriptionWindow') : t('modals.describeGroup.description')}</DialogDescription>
      </DialogHeader>

      {/* Long text wraps and only these boxes scroll (fixed 800x600 popup, no outer scrollbars) */}
      <section className="min-w-0 space-y-1" aria-labelledby="describe-group-current">
        <h3 id="describe-group-current" className="text-xs font-medium text-muted-foreground">{t('modals.describeGroup.current')}</h3>
        <p
          dir="auto"
          className="max-h-24 min-w-0 overflow-y-auto whitespace-pre-wrap break-words border border-border bg-muted/40 px-2 py-1.5 text-xs text-start"
          data-testid="describe-group-current-note"
        >
          {note}
        </p>
      </section>

      <section className="min-w-0 space-y-1" aria-labelledby="describe-group-suggestion">
        <h3 id="describe-group-suggestion" className="text-xs font-medium text-muted-foreground">{t('modals.describeGroup.suggestion')}</h3>
        <p
          dir="auto"
          className="max-h-24 min-w-0 overflow-y-auto whitespace-pre-wrap break-words border border-primary/40 px-2 py-1.5 text-xs text-start"
          data-testid="describe-group-suggestion"
        >
          {description}
        </p>
      </section>

      {!canAppend && (
        <p className="text-[0.625rem] text-muted-foreground">{t('modals.describeGroup.tooLong', { max })}</p>
      )}

      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => void choose(appendDescription(note, description), t('groupMenu.toast.noteAdded'))}
          disabled={saving || !found || !canAppend}
        >
          {t('modals.describeGroup.append')}
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={() => void choose(description, t('groupMenu.toast.noteReplaced'))}
          disabled={saving || !found || !description}
        >
          {t('modals.describeGroup.replace')}
        </Button>
      </div>
    </div>
  );
}
