import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useEntitlements } from '@/hooks/useEntitlements';
import {
  RECENTLY_CLOSED_UNDO_TOAST_MS,
  useClearRecentlyClosed,
  useRecentlyClosed,
  useSetRememberClosedTabs,
  useUndoRecentlyClosed,
  type RecentlyClosedUndo
} from '@/hooks/useRecentlyClosed';
import { readRememberClosedTabs } from '@/lib/recentlyClosed';
import { recentlyClosedKeepsLine } from '@/lib/recentlyClosedDays';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import { SettingsSection } from '@/components/Settings/SettingsSection';

interface RecentlyClosedSettingsProps {
  /** Called after the switch was saved (it saves at once), so the modal patches its draft with it. */
  onSettingsSaved: (patch: { rememberClosedTabs: boolean }) => void;
}

/**
 * Settings → Data → "Remember closed tabs": the switch on the heading line, then how long the plan
 * keeps entries and how many are in the list, and "Clear list". Turning it off and Clear list act
 * at once with an Undo toast (no dialog): the entries are only marked and the worker deletes them
 * after the undo window. The list lives only on this device.
 */
export function RecentlyClosedSettings({ onSettingsSaved }: RecentlyClosedSettingsProps) {
  const { t } = useTranslation();
  const ids = { description: `${useId()}-desc` };
  const { data: saved, isLoading: settingsLoading } = useAppSettings();
  const { tier, loading: planLoading } = useEntitlements();
  const { entries } = useRecentlyClosed();
  const { mutateAsync: setRemember, isPending: switching } = useSetRememberClosedTabs();
  const { mutateAsync: clearAll, isPending: clearing } = useClearRecentlyClosed();
  const { mutate: undo } = useUndoRecentlyClosed();
  const on = readRememberClosedTabs(saved);

  const undoAction = (token: RecentlyClosedUndo, afterUndo?: () => void) => ({
    label: t('header.undo'),
    onClick: () =>
      undo(token, {
        onSuccess: ({ complete }) => {
          afterUndo?.();
          // the Undo came after the worker deleted (some of) the cleared entries
          if (complete) return;
          const turnedOn = token.kind === 'unmark' && token.turnBackOn === true;
          toast.error(t(turnedOn ? 'recentlyClosed.errors.undoTurnedOnListGone' : 'recentlyClosed.errors.undoIncomplete'));
        },
        onError: () => toast.error(t('recentlyClosed.errors.changeFailed'))
      })
  });

  const toggle = async (next: boolean) => {
    // never write over settings that have not been read yet
    if (settingsLoading) return;
    try {
      const token = await setRemember(next);
      onSettingsSaved({ rememberClosedTabs: next });
      trackEvent('recently_closed_toggled', { on: next ? 1 : 0 });
      if (next || !token) return;
      const message = token.ids.length > 0 ? t('recentlyClosed.toast.turnedOffCleared', { count: token.ids.length }) : t('recentlyClosed.toast.turnedOff');
      toast.success(message, {
        id: 'recently-closed-off',
        duration: RECENTLY_CLOSED_UNDO_TOAST_MS,
        action: undoAction(token, () => onSettingsSaved({ rememberClosedTabs: true }))
      });
    } catch {
      toast.error(t('recentlyClosed.errors.changeFailed'));
    }
  };

  const clear = async () => {
    try {
      const token = await clearAll();
      if (token.ids.length === 0) return;
      trackEvent('recently_closed_cleared');
      toast.success(t('recentlyClosed.toast.cleared', { count: token.ids.length }), {
        id: 'recently-closed-cleared',
        duration: RECENTLY_CLOSED_UNDO_TOAST_MS,
        action: undoAction(token)
      });
    } catch {
      toast.error(t('recentlyClosed.errors.changeFailed'));
    }
  };

  const summary = planLoading
    ? t('recentlyClosed.settings.checkingPlan')
    : `${recentlyClosedKeepsLine(tier === 'free' ? 'free' : 'pro')} · ${t('recentlyClosed.settings.inList', { count: entries.length })}`;

  return (
    <SettingsSection
      section="recently-closed"
      testId="recently-closed-settings"
      title={t('recentlyClosed.settings.title')}
      purpose={t('recentlyClosed.settings.purpose')}
      headerAction={
        <Switch
          className="shrink-0"
          // named by the section title (the heading is not a <label>), described by the status line
          aria-label={t('recentlyClosed.settings.title')}
          aria-describedby={ids.description}
          checked={!settingsLoading && on}
          disabled={settingsLoading || switching}
          onCheckedChange={(v) => void toggle(v === true)}
        />
      }
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p id={ids.description} className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="recently-closed-summary">
          {on ? summary : t('recentlyClosed.settings.off')}
        </p>
        {on && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 rounded-none text-xs"
            disabled={entries.length === 0 || clearing}
            onClick={() => void clear()}
          >
            {t('recentlyClosed.settings.clear')}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
