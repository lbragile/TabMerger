import { useState } from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LanguagePicker } from '@/components/LanguagePicker';
import { useLocalePreference } from '@/hooks/useLocalePreference';
import { activeLocale } from '@/lib/i18n';

/** The language in use as a short code for the button: "EN", "DE", "PT", "ZH". */
function shortCode(locale: string): string {
  return locale.split('-')[0].toUpperCase();
}

/**
 * Header: the language menu. A search box over "Browser default" and every shipped language by
 * its own name (`LanguagePicker`), the stored choice checked. Picking one applies it at once,
 * stores it (the same choice as Settings → General → Language) and closes the menu; focus goes
 * back to the button.
 *
 * A popover, not a Radix menu: a menu's typeahead and focus-on-hover fight a text field inside it.
 * Its height is capped to the room Radix measures below the button, so the list scrolls inside
 * the fixed popup instead of running off it.
 */
export function LanguageMenu() {
  const { t } = useTranslation();
  const { preference, choose } = useLocalePreference();
  const [open, setOpen] = useState(false);
  const code = shortCode(activeLocale());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
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
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('header.language')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="flex w-80 max-h-[min(24rem,var(--radix-popover-content-available-height))] flex-col p-0"
        data-testid="language-menu"
      >
        <LanguagePicker
          value={preference}
          onPick={(choice) => {
            setOpen(false);
            void choose(choice);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
