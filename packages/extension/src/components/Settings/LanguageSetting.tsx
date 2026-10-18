import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOCALE_PREFERENCE_AUTO, localePreferenceChoices, localePreferenceLabel, type LocalePreference } from '@/lib/localePreference';

interface LanguageSettingProps {
  value: LocalePreference;
  onChange: (value: string) => void;
}

/**
 * Settings → General: "Language". "Browser default" first, then every shipped language by its own
 * name (a reader finds theirs whatever the UI is shown in), each marked with its `lang` so screen
 * readers pronounce it right. Only changes the draft: Settings' "Save changes" applies it.
 */
export function LanguageSetting({ value, onChange }: LanguageSettingProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label className="text-sm">{t('settings.general.languageLabel')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.general.languageDescription')}</p>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40 h-7 text-xs shrink-0" aria-label={t('settings.general.languageLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {localePreferenceChoices().map((choice) => (
            <SelectItem key={choice} value={choice} lang={choice === LOCALE_PREFERENCE_AUTO ? undefined : choice}>
              {localePreferenceLabel(choice, t('settings.general.languageAuto'))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
