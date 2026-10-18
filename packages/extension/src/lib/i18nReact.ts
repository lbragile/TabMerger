/**
 * Side-effect import for React pages (popup, site access): initializes i18next with the
 * react-i18next binding and sets `<html lang dir>`. Imported first in each page's main.tsx so the
 * catalog is ready before any module or component asks for a string.
 */
import { initReactI18next } from 'react-i18next';
import { applyDocumentLocale, applyLocalePreference, initI18n } from '@/lib/i18n';
import { onLocalePreferenceChanged, reconcileLocalePreference } from '@/lib/localePreference';

initI18n(initReactI18next);
applyDocumentLocale();
// The page started from its localStorage copy of the Settings language choice; if that copy is
// missing or stale (cleared site data), the one the background follows wins
void reconcileLocalePreference()
  .then((stored) => (stored ? applyLocalePreference(stored) : false))
  .catch(() => {});
// A choice saved on another extension page (Settings in the popup) switches this one too
onLocalePreferenceChanged((preference) => void applyLocalePreference(preference).catch(() => {}));
