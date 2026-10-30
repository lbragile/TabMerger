import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LanguagePicker } from '@/components/LanguagePicker';
import { SETTINGS_SELECT_WIDTH } from '@/components/Settings/settingsControls';
import { LOCALE_PREFERENCE_AUTO, localePreferenceLabel, type LocalePreference } from '@/lib/localePreference';

interface LanguageSettingProps {
  value: LocalePreference;
  onChange: (value: string) => void;
}

/**
 * Settings → General: "Language". A button showing the draft opens the same searchable list as
 * the header's language menu (`LanguagePicker`): "Browser default" first, then every shipped
 * language by its own name (a reader finds theirs whatever the UI is shown in), each marked with
 * its `lang` so screen readers pronounce it right. Only changes the draft: Settings' "Save
 * changes" applies it.
 */
export function LanguageSetting({ value, onChange }: LanguageSettingProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label id={labelId} className="text-sm">{t('settings.general.languageLabel')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.general.languageDescription')}</p>
      </div>
      {/* modal: the list is portaled outside the Settings dialog, whose scroll lock otherwise
          swallows mouse-wheel events there; a modal popover takes the lock and scrolls itself */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            // "Language Deutsch": the row's label, then the value
            aria-labelledby={`${labelId} ${valueId}`}
            className={`flex h-7 ${SETTINGS_SELECT_WIDTH} shrink-0 items-center justify-between gap-2 border border-input bg-transparent px-3 text-xs shadow-xs focus:outline-none focus:ring-1 focus:ring-ring`}
            data-testid="settings-language"
          >
            <span id={valueId} className="truncate" lang={value === LOCALE_PREFERENCE_AUTO ? undefined : value}>
              {localePreferenceLabel(value, t('settings.general.languageAuto'))}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={8}
          className="flex w-80 max-h-[min(20rem,var(--radix-popover-content-available-height))] flex-col p-0"
          data-testid="settings-language-list"
        >
          <LanguagePicker
            value={value}
            onPick={(choice) => {
              setOpen(false);
              onChange(choice);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
