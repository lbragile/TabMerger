import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, PilcrowLeft, Search } from 'lucide-react';
import { SUPPORTED_LOCALES, filterLocales, isRtlLocale, localeNameIn } from '@tabmerger/shared';
import { cn } from '@/lib/utils';
import { activeLocale } from '@/lib/i18n';
import { LOCALE_PREFERENCE_AUTO, localePreferenceLabel, type LocalePreference } from '@/lib/localePreference';

/** Between the parts of an option's accessible name; never drawn. */
const NAME_SEPARATOR = ', ';

/** A language written right to left gets the ¶← mark (never "Browser default"). */
const rtlRow = (choice: LocalePreference) => choice !== LOCALE_PREFERENCE_AUTO && isRtlLocale(choice);

interface LanguagePickerProps {
  /** The choice shown as checked (the stored one in the header, the draft in Settings). */
  value: LocalePreference;
  onPick: (choice: LocalePreference) => void;
  className?: string;
}

/**
 * The language list of the header menu and of Settings → General → Language: a search box
 * (`role="combobox"`) over a `role="listbox"`. "Browser default" is always first; the languages
 * below it are narrowed by `filterLocales` (native name, English name, name in the UI language,
 * code and aliases such as "iw" or "farsi").
 *
 * Focus stays in the search box; Up and Down move the highlighted option
 * (`aria-activedescendant`), Enter picks it (after typing, the first match), Escape closes the
 * popover that hosts it. The current choice is checked and scrolled into view on open. The list
 * scrolls inside the host, which caps the height so it never leaves the popup.
 */
export function LanguagePicker({ value, onPick, className }: LanguagePickerProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;
  const languages = useMemo(
    () => filterLocales(query, SUPPORTED_LOCALES, activeLocale()),
    // the names in the UI language change with it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, i18n.language]
  );
  const choices: LocalePreference[] = useMemo(() => [LOCALE_PREFERENCE_AUTO, ...languages], [languages]);
  // Each language's name in the UI language beside its own ("Deutsch" / "German"); none for the
  // UI's own language. The same helper as the website's picker.
  const secondaryName = (choice: LocalePreference): string | undefined =>
    choice === LOCALE_PREFERENCE_AUTO ? undefined : localeNameIn(choice, activeLocale());

  // The highlighted option: the current choice on open, the first match once something is typed
  const [active, setActive] = useState(() => Math.max(0, choices.indexOf(value)));
  const typed = query.trim() !== '';
  useEffect(() => {
    setActive(typed && languages.length > 0 ? 1 : Math.max(0, choices.indexOf(value)));
    // only when the list itself changes, not when the highlight moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);

  // Keeps the highlighted option in view by scrolling the list itself (never the page). Runs
  // again when the list changes size: the popover caps its height only after it is positioned,
  // so on open the first pass sees the whole list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => {
      const option = list.querySelector<HTMLElement>(`[id="${optionId(active)}"]`);
      if (!option) return;
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    };
    reveal();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.min(choices.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const choice = choices[active];
      if (choice) onPick(choice);
    }
  };

  const autoLabel = t('settings.general.languageAuto');
  const rtlLabel = t('settings.general.languageRtl');
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          // Typed text is a language name in any script: its own direction. Only once there is
          // some: an empty `dir="auto"` box is left to right in Chromium, which would lay the
          // placeholder out backwards in a right-to-left UI.
          dir={query ? 'auto' : undefined}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={choices[active] ? optionId(active) : undefined}
          aria-label={t('settings.general.languageSearchLabel')}
          placeholder={t('settings.general.languageSearchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          spellCheck={false}
          data-testid="language-search"
        />
      </div>
      <div ref={listRef} className="scrollbar-themed relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        <div id={listId} role="listbox" aria-label={t('settings.general.languageLabel')}>
          {choices.map((choice, i) => {
            const secondary = secondaryName(choice);
            return (
              <div
                key={choice}
                id={optionId(i)}
                role="option"
                aria-selected={choice === value}
                // "עברית, Hebrew, Right-to-left": one string, because a screen reader (and Chromium's
                // name computation) puts a space between flex items, so separate spans read "עברית , Hebrew"
                aria-label={[localePreferenceLabel(choice, autoLabel), secondary, rtlRow(choice) ? rtlLabel : undefined]
                  .filter(Boolean)
                  .join(NAME_SEPARATOR)}
                data-active={i === active ? '' : undefined}
                className="flex h-7 cursor-pointer select-none items-center gap-2 px-2 text-xs outline-none data-[active]:bg-accent data-[active]:text-accent-foreground"
                // Keep focus (and the caret) in the search box
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick(choice)}
              >
                {/* A fixed column, so every name starts at the same place whether checked or not */}
                <span className="flex w-3.5 shrink-0 justify-center" aria-hidden="true">
                  {choice === value && <Check className="h-3.5 w-3.5" />}
                </span>
                {/* The language's own name, in its own script and direction */}
                <span
                  dir={choice === LOCALE_PREFERENCE_AUTO ? undefined : 'auto'}
                  lang={choice === LOCALE_PREFERENCE_AUTO ? undefined : choice}
                  data-native=""
                  className="min-w-0 flex-1 truncate text-ui-start"
                >
                  {localePreferenceLabel(choice, autoLabel)}
                </span>
                {secondary && (
                  <span className="max-w-[45%] shrink-0 truncate text-[0.6875rem] text-muted-foreground">{secondary}</span>
                )}
                {/* A fixed slot at the row's end, so the names never move: the right-to-left mark */}
                <span
                  className="ms-auto flex w-3.5 shrink-0 justify-center text-muted-foreground"
                  title={rtlRow(choice) ? rtlLabel : undefined}
                  data-rtl-mark={rtlRow(choice) ? '' : undefined}
                >
                  {rtlRow(choice) && <PilcrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
              </div>
            );
          })}
        </div>
        {/* Outside the listbox (only options belong in it). Always mounted, so the message is
            announced when the list empties. */}
        <p role="status" className={languages.length === 0 ? 'px-2 py-3 text-center text-xs text-muted-foreground' : 'sr-only'}>
          {languages.length === 0 ? t('settings.general.languageNoMatch') : null}
        </p>
      </div>
    </div>
  );
}
