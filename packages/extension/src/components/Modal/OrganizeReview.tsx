import { useState, type ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Archive, ArrowUpDown, GitMerge, PencilLine } from 'lucide-react';
import type { OrganizeAction } from '@tabmerger/shared';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useGroups } from '@/hooks/useGroups';
import { useApplyOrganize } from '@/hooks/useApplyOrganize';
import { toast } from '@/lib/toast';
import type { Group } from '@/lib/types';

interface OrganizeReviewModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** A group name inside a translated row: isolated (mixed-direction safe) and cut with an ellipsis, full name in the title. */
const nameSlot = (name: string) => <bdi title={name} className="inline-block max-w-[9rem] truncate align-bottom font-medium" />;

const ICON_CLASS = 'h-3.5 w-3.5 shrink-0 mt-px text-muted-foreground';

/** One row's icon and wording, or null when a group it names is no longer here (the row is left out). */
function describe(action: OrganizeAction, groupById: Map<string, Group>): { icon: ReactElement; label: ReactElement } | null {
  const name = (id: string) => groupById.get(id)?.name;
  switch (action.type) {
    case 'merge': {
      const from = name(action.sourceGroupId);
      const to = name(action.targetGroupId);
      if (from === undefined || to === undefined) return null;
      return {
        icon: <GitMerge className={ICON_CLASS} aria-hidden="true" />,
        label: <Trans i18nKey="modals.organize.merge" values={{ from, to }} components={{ from: nameSlot(from), to: nameSlot(to) }} />
      };
    }
    case 'rename': {
      const from = name(action.groupId);
      if (from === undefined) return null;
      return {
        icon: <PencilLine className={ICON_CLASS} aria-hidden="true" />,
        label: <Trans i18nKey="modals.organize.rename" values={{ from, to: action.newName }} components={{ from: nameSlot(from), to: nameSlot(action.newName) }} />
      };
    }
    case 'delete': {
      const group = name(action.groupId);
      if (group === undefined) return null;
      return {
        icon: <Archive className={ICON_CLASS} aria-hidden="true" />,
        label: <Trans i18nKey="modals.organize.archive" values={{ name: group }} components={{ name: nameSlot(group) }} />
      };
    }
    case 'reorder': {
      const names = action.groupIds.map(name).filter((n): n is string => n !== undefined);
      if (names.length < 2) return null;
      return {
        icon: <ArrowUpDown className={ICON_CLASS} aria-hidden="true" />,
        label: (
          <>
            <Trans i18nKey="modals.organize.reorder" />
            {/* (Trans, not t: describe() is a plain function, not a component with the hook) */}
            {/* The new order, one chip per group (no separators: chips read the same in both directions) */}
            <span className="mt-1 flex flex-wrap gap-1">
              {names.map((n, i) => (
                <bdi key={i} title={n} className="max-w-[8rem] truncate border border-border px-1 text-[0.625rem] text-muted-foreground">{n}</bdi>
              ))}
            </span>
          </>
        )
      };
    }
    default:
      return null;
  }
}

/**
 * Review of the changes AI Organize proposes (opened by the header's AI menu → Organize): one
 * checkbox row per action, all checked, and "Apply selected" applies the checked ones locally in
 * one write (`useApplyOrganize`: one undo step, one sync push). The AI's `delete` is offered and
 * applied as Archive (reversible), never a hard delete. Cancel changes nothing.
 */
export function OrganizeReviewModal({ data, onClose }: OrganizeReviewModalProps) {
  const { t } = useTranslation();
  const actions = Array.isArray(data.actions) ? (data.actions as OrganizeAction[]) : [];
  const { data: groupsState } = useGroups();
  const { mutateAsync: applyOrganize, isPending } = useApplyOrganize();
  const [unchecked, setUnchecked] = useState<ReadonlySet<number>>(() => new Set());

  const groupById = new Map((groupsState?.available ?? []).map((g) => [g.id, g] as const));
  const rows = actions
    .map((action, index) => ({ action, index, view: describe(action, groupById) }))
    .filter((row): row is typeof row & { view: NonNullable<typeof row.view> } => row.view !== null);
  const selected = rows.filter((row) => !unchecked.has(row.index)).map((row) => row.action);

  const toggle = (index: number) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const handleApply = async () => {
    try {
      const { applied } = await applyOrganize(selected);
      onClose();
      if (applied === 0) toast.info(t('modals.organize.nothingApplied'));
      else toast.success(t('modals.organize.applied', { count: applied }));
    } catch (err) {
      console.error('[TabMerger] Organize apply failed:', err);
      toast.error(t('modals.organize.applyFailed'));
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DialogHeader className="min-w-0">
        <DialogTitle>{t('modals.organize.title')}</DialogTitle>
        <DialogDescription>{t('modals.organize.description', { count: rows.length })}</DialogDescription>
      </DialogHeader>

      {/* Only this list scrolls (the popup is a fixed 800x600 with no outer scrollbars) */}
      <ul className="max-h-[18rem] min-w-0 overflow-y-auto border border-border" data-testid="organize-review-list">
        {rows.map(({ action, index, view }) => (
          <li key={index} className="min-w-0 border-b border-border last:border-b-0">
            <label className="flex min-w-0 cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-muted/50">
              <input
                type="checkbox"
                className="mt-px h-3.5 w-3.5 shrink-0 accent-primary"
                checked={!unchecked.has(index)}
                onChange={() => toggle(index)}
                data-testid={`organize-action-${action.type}`}
              />
              {view.icon}
              <span className="min-w-0 flex-1 text-start">{view.label}</span>
            </label>
          </li>
        ))}
      </ul>

      {rows.some(({ action }) => action.type === 'delete') && (
        <p className="text-[0.625rem] text-muted-foreground">{t('modals.organize.archiveNote')}</p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose} disabled={isPending}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" className="flex-1 text-xs" onClick={() => void handleApply()} disabled={isPending || selected.length === 0}>
          {t('modals.organize.apply')}
        </Button>
      </div>
    </div>
  );
}
