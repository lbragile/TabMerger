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
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import { SETTINGS_SELECT_WIDTH } from '@/components/Settings/settingsControls';

export type AutoSaveSettingsPatch = Partial<Pick<AppSettings, 'autoSaveTabsEnabled' | 'autoSaveIntervalMinutes' | 'autoSaveTabThreshold' | 'autoSaveNotify'>>;

interface AutoSaveTabsProps {
  /** Called after a setting was saved (they save immediately), so the modal patches its draft with it. */
  onSettingsSaved: (patch: AutoSaveSettingsPatch) => void;
}

/**
 * Settings → Data → "Auto-save open tabs" (first on the tab): the switch, the schedule, the
 * open-tab threshold, the notification switch, the last run and "Auto-save now". Every plan gets
 * the controls; Free is told about the newest-2 rule and the limits, with an upgrade link. The
 * switch's default follows the plan until the user toggles it.
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
  const ids = { enabled: `${id}-enabled`, description: `${id}-desc`, schedule: `${id}-schedule`, threshold: `${id}-threshold`, hint: `${id}-hint`, notify: `${id}-notify`, notifyDescription: `${id}-notify-desc` };

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

  return (
    <section aria-label={t('autoSave.settings.title')} className="min-w-0 space-y-3" data-testid="auto-save-settings">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor={ids.enabled} className="text-sm">{t('autoSave.settings.title')}</Label>
          <p id={ids.description} className="text-xs text-muted-foreground">
            {planLoading
              ? t('autoSave.settings.checkingPlan')
              : paid
                ? t('autoSave.settings.description')
                : t('autoSave.settings.descriptionFree', { keep: AUTO_SAVE_FREE_KEEP_COUNT, groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs })}
          </p>
          {!planLoading && !paid && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                trackEvent('upgrade_clicked', { source: 'settings_auto_save' });
                chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`, active: true });
              }}
            >
              {t('autoSave.settings.upgrade')}
            </Button>
          )}
        </div>
        <Switch
          id={ids.enabled}
          className="shrink-0"
          aria-describedby={ids.description}
          checked={!busy && settings.enabled}
          disabled={busy}
          onCheckedChange={(v) => void save({ autoSaveTabsEnabled: v === true })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={ids.schedule} className="text-sm min-w-0 flex-1">{t('autoSave.settings.scheduleLabel')}</Label>
        <Select
          value={String(settings.intervalMinutes)}
          disabled={!settings.enabled || busy}
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
          disabled={!settings.enabled || busy}
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

      {/* Always in the DOM, only its text changes (a status mounted with its text is often not
          announced). Empty, it takes no room: -mt-3 cancels the gap, flow-root stops margin collapse. */}
      <p id={ids.hint} className={cn('min-w-0 text-xs text-muted-foreground', !(settings.enabled && noTrigger) && '-mt-3 flow-root')} role="status">
        {settings.enabled && noTrigger ? t('autoSave.settings.noTrigger') : ''}
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
          disabled={!settings.enabled || busy}
          onCheckedChange={(v) => void save({ autoSaveNotify: v === true })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
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
    </section>
  );
}
