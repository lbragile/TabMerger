import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AUTO_SAVE_FREE_KEEP_COUNT,
  AUTO_SAVE_INTERVAL_OPTIONS,
  AUTO_SAVE_THRESHOLD_OPTIONS,
  FREE_TIER_LIMITS,
  isAutoSaveInterval,
  isAutoSaveThreshold,
  type AutoSaveIntervalMinutes,
  type AutoSaveTabThreshold
} from '@tabmerger/shared';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAppSettings, useSaveAppSettings, DEFAULT_APP_SETTINGS, type AppSettings } from '@/hooks/useAppSettings';
import { useAutoSaveNow, useAutoSaveState } from '@/hooks/useAutoSave';
import { describeAutoSaveOutcome, readAutoSaveSettings } from '@/lib/autoSave';
import { formatTimeAgo } from '@/lib/i18n';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import { SETTINGS_SELECT_WIDTH } from '@/components/Settings/settingsControls';
import { SETTINGS_SUB_BOX, SettingsSection } from '@/components/Settings/SettingsSection';
import { cn } from '@/lib/utils';

export type AutoSaveSettingsPatch = Partial<Pick<AppSettings, 'autoSaveTabsEnabled' | 'autoSaveIntervalMinutes' | 'autoSaveTabThreshold' | 'autoSaveNotify'>>;

interface AutoSaveTabsProps {
  /** Called after a setting was saved (they save immediately), so the modal patches its draft with it. */
  onSettingsSaved: (patch: AutoSaveSettingsPatch) => void;
}

/**
 * Settings → Data → "Auto-save open tabs" (first on the tab): the switch on the heading line and,
 * while it is on, a box with the schedule, the open-tab threshold and the notification switch.
 * The last run and "Auto-save now" are always shown (a manual run ignores the switch). Every plan
 * gets the controls; Free gets one line about the newest-2 rule and the limits, with an upgrade
 * link. The switch's default follows the plan until the user toggles it.
 */
export function AutoSaveTabs({ onSettingsSaved }: AutoSaveTabsProps) {
  const { t } = useTranslation();
  const { tier, loading: planLoading } = useEntitlements();
  const paid = tier !== 'free';
  const { data: saved, isLoading: settingsLoading } = useAppSettings();
  const { mutateAsync: saveAppSettings } = useSaveAppSettings();
  const { data: state } = useAutoSaveState();
  const { run, running } = useAutoSaveNow();
  const settings = readAutoSaveSettings(saved, paid);
  const noTrigger = settings.intervalMinutes === 0 && settings.threshold === 0;
  const busy = settingsLoading || planLoading;
  const id = useId();
  const ids = { description: `${id}-desc`, schedule: `${id}-schedule`, threshold: `${id}-threshold`, hint: `${id}-hint`, notify: `${id}-notify`, notifyDescription: `${id}-notify-desc` };

  const save = async (patch: AutoSaveSettingsPatch) => {
    // never write defaults over settings that have not been read yet
    if (settingsLoading) return;
    try {
      await saveAppSettings({ ...(saved ?? DEFAULT_APP_SETTINGS), ...patch });
      onSettingsSaved(patch);
    } catch {
      toast.error(t('autoSave.toast.settingFailed'));
    }
  };

  const last = state?.last;
  const statusLine = last
    ? t('autoSave.status.lastRun', { when: formatTimeAgo(last.at), result: describeAutoSaveOutcome(last).message })
    : t('autoSave.status.never');

  // The options box shows only while auto-save is on (and its state is known).
  const on = !busy && settings.enabled;
  const planNote = planLoading ? (
    <p id={ids.description} className="min-w-0 text-xs text-muted-foreground">{t('autoSave.settings.checkingPlan')}</p>
  ) : !paid ? (
    <p id={ids.description} className="min-w-0 text-xs text-muted-foreground">
      {t('autoSave.settings.freeLimits', { keep: AUTO_SAVE_FREE_KEEP_COUNT, groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs })}{' '}
      <Button
        variant="link"
        size="sm"
        className="inline h-auto whitespace-normal p-0 text-start align-baseline text-xs"
        onClick={() => {
          trackEvent('upgrade_clicked', { source: 'settings_auto_save' });
          chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`, active: true });
        }}
      >
        {t('autoSave.settings.upgrade')}
      </Button>
    </p>
  ) : null;

  return (
    <SettingsSection
      section="autosave"
      testId="auto-save-settings"
      title={t('autoSave.settings.title')}
      purpose={t('autoSave.settings.purpose')}
      headerAction={
        <Switch
          className="shrink-0"
          // named by the section title (the heading is not a <label>); described by the plan line when there is one
          aria-label={t('autoSave.settings.title')}
          aria-describedby={planNote ? ids.description : undefined}
          checked={on}
          disabled={busy}
          onCheckedChange={(v) => void save({ autoSaveTabsEnabled: v === true })}
        />
      }
    >
      {!on && planNote}

      {/* One element whether on or off, so "Auto-save now" keeps its place (and keyboard focus)
          when the switch flips. On, it is the bordered box with the options; off, only the last
          run and "Auto-save now" (a manual run works with the switch off). */}
      <div className={cn('min-w-0 space-y-3', on && SETTINGS_SUB_BOX)} data-testid="auto-save-options">
        {on && (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={ids.schedule} className="text-sm min-w-0 flex-1">{t('autoSave.settings.scheduleLabel')}</Label>
              <Select
                value={String(settings.intervalMinutes)}
                onValueChange={(v) => {
                  const minutes = Number(v);
                  if (isAutoSaveInterval(minutes)) void save({ autoSaveIntervalMinutes: minutes as AutoSaveIntervalMinutes });
                }}
              >
                <SelectTrigger id={ids.schedule} aria-describedby={ids.hint} className={`${SETTINGS_SELECT_WIDTH} h-7 text-xs shrink-0`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_SAVE_INTERVAL_OPTIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {t(`autoSave.settings.schedule.${minutes}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={ids.threshold} className="text-sm min-w-0 flex-1">{t('autoSave.settings.thresholdLabel')}</Label>
              <Select
                value={String(settings.threshold)}
                onValueChange={(v) => {
                  const count = Number(v);
                  if (isAutoSaveThreshold(count)) void save({ autoSaveTabThreshold: count as AutoSaveTabThreshold });
                }}
              >
                <SelectTrigger id={ids.threshold} aria-describedby={ids.hint} className={`${SETTINGS_SELECT_WIDTH} h-7 text-xs shrink-0`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTO_SAVE_THRESHOLD_OPTIONS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count === 0 ? t('autoSave.settings.thresholdOff') : t('autoSave.settings.thresholdOption', { count })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Always in the box, only its text changes (a status mounted with its text is often
                not announced). Empty, it takes no room: -mt-3 cancels the gap, flow-root stops
                margin collapse. */}
            <p id={ids.hint} className={cn('min-w-0 text-xs text-muted-foreground', !noTrigger && '-mt-3 flow-root')} role="status">
              {noTrigger ? t('autoSave.settings.noTrigger') : ''}
            </p>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label htmlFor={ids.notify} className="text-sm">{t('autoSave.settings.notifyLabel')}</Label>
                <p id={ids.notifyDescription} className="text-xs text-muted-foreground">{t('autoSave.settings.notifyDescription')}</p>
              </div>
              <Switch
                id={ids.notify}
                className="shrink-0"
                aria-describedby={ids.notifyDescription}
                checked={settings.notify}
                onCheckedChange={(v) => void save({ autoSaveNotify: v === true })}
              />
            </div>

            <p className="min-w-0 text-xs text-muted-foreground">{t('autoSave.settings.skipNote')}</p>
          </>
        )}

        <div className={cn('flex items-center justify-between gap-4', on && 'border-t border-border pt-3')}>
          {/* not a live region: "Auto-save now" already says how it ended in a toast */}
          <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="auto-save-status">
            {statusLine}
          </p>
          <Button
            variant="outline"
            size="sm"
            // aria-disabled, not disabled: a disabled button drops keyboard focus while the run goes
            className="text-xs shrink-0 rounded-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
            aria-disabled={running}
            aria-busy={running}
            onClick={() => void run()}
          >
            {running ? t('autoSave.settings.running') : t('autoSave.settings.runNow')}
          </Button>
        </div>
      </div>

      {on && planNote}
    </SettingsSection>
  );
}
