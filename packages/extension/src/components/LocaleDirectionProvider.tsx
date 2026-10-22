import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DirectionProvider, useDirection } from '@radix-ui/react-direction';
import type { TextDirection } from '@/lib/direction';

/**
 * The reading direction of the active language, as Radix primitives read it (dropdown and
 * context menus open their submenus towards it and flip Left/Right, Select, Tabs and ScrollArea
 * put their parts on the matching side). Wraps each page's root (popup, site access).
 *
 * `useTranslation` re-renders this on every language change, so a pick in the header's language
 * menu flips every primitive at once, like `<html dir>` (set by `applyDocumentLocale`).
 */
export function LocaleDirectionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const dir: TextDirection = i18n.dir(i18n.resolvedLanguage ?? i18n.language) === 'rtl' ? 'rtl' : 'ltr';
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}

/** The UI direction from the nearest {@link LocaleDirectionProvider} (`ltr` outside one). */
export function useUiDirection(): TextDirection {
  return useDirection() === 'rtl' ? 'rtl' : 'ltr';
}
