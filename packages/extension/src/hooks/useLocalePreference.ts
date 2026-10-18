import { useCallback, useEffect, useRef, useState } from 'react';
import { applyLocalePreference } from '@/lib/i18n';
import {
  LOCALE_PREFERENCE_AUTO,
  normalizeLocalePreference,
  onLocalePreferenceChanged,
  readLocalePreferenceSync,
  saveLocalePreference,
  type LocalePreference
} from '@/lib/localePreference';

/**
 * The stored language choice (`lib/localePreference.ts`) and a way to change it right away: store
 * it and switch the UI. Used directly by the header's language menu; follows a change saved
 * anywhere else (Settings, another extension page).
 */
export function useLocalePreference() {
  const [preference, setPreference] = useState<LocalePreference>(readLocalePreferenceSync);

  useEffect(() => onLocalePreferenceChanged(setPreference), []);

  /** Stores `value` (narrowed to a shipped locale or `auto`) and switches the UI to it. */
  const choose = useCallback(async (value: unknown) => {
    const next = normalizeLocalePreference(value);
    setPreference(next);
    await saveLocalePreference(next);
    await applyLocalePreference(next);
  }, []);

  return { preference, choose };
}

/**
 * The Language row of Settings → General, which follows the tab's draft-then-Save model: picking
 * a language only changes the draft; "Save changes" stores it and switches the UI, and "Restore
 * defaults" puts the draft back to the browser's language. The saved value is the same stored
 * choice the header menu changes, so the row always starts from (and, while untouched, follows)
 * what is in use. Kept out of AppSettings because the choice is per device and never synced.
 */
export function useLanguageSetting() {
  const { preference: saved, choose } = useLocalePreference();
  const [draft, setDraftState] = useState<LocalePreference>(saved);

  // A choice saved elsewhere moves an untouched draft along with it (never an edited one)
  const prevSaved = useRef(saved);
  useEffect(() => {
    const previous = prevSaved.current;
    prevSaved.current = saved;
    setDraftState((current) => (current === previous ? saved : current));
  }, [saved]);

  return {
    draft,
    /** Any value from the select is narrowed to a shipped locale or `auto`. */
    setDraft: (value: unknown) => setDraftState(normalizeLocalePreference(value)),
    isDirty: draft !== saved,
    reset: () => setDraftState(LOCALE_PREFERENCE_AUTO),
    /** Stores the draft and switches the UI to it. No-op when nothing changed. */
    save: async () => {
      if (draft !== saved) await choose(draft);
    }
  };
}
