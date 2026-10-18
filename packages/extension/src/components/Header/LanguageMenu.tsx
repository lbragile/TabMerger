import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useLocalePreference } from '@/hooks/useLocalePreference';
import { activeLocale } from '@/lib/i18n';
import { LOCALE_PREFERENCE_AUTO, localePreferenceChoices, localePreferenceLabel } from '@/lib/localePreference';

/** The language in use as a short code for the button: "EN", "DE", "PT", "ZH". */
function shortCode(locale: string): string {
  return locale.split('-')[0].toUpperCase();
}

/**
 * Header: the language menu. "Browser default" first, then every shipped language by its own name,
 * the stored choice checked. Picking one applies it at once and stores it (the same choice as
 * Settings → General → Language).
 */
export function LanguageMenu() {
  const { t } = useTranslation();
  const { preference, choose } = useLocalePreference();
  const code = shortCode(activeLocale());

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-muted-foreground"
              // The visible code is part of the name (WCAG 2.5.3, label in name)
              aria-label={t('header.languageButton', { code })}
              data-testid="header-language"
            >
              <Languages className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium leading-none">{code}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('header.language')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44 text-xs">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">{t('header.language')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={preference} onValueChange={(value) => void choose(value)}>
          {localePreferenceChoices().map((choice) => (
            <DropdownMenuRadioItem
              key={choice}
              value={choice}
              className="text-xs"
              lang={choice === LOCALE_PREFERENCE_AUTO ? undefined : choice}
            >
              {localePreferenceLabel(choice, t('settings.general.languageAuto'))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
