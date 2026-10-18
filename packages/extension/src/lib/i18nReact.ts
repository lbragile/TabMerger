/**
 * Side-effect import for React pages (popup, site access): initializes i18next with the
 * react-i18next binding and sets `<html lang dir>`. Imported first in each page's main.tsx so the
 * catalog is ready before any module or component asks for a string.
 */
import { initReactI18next } from 'react-i18next';
import { applyDocumentLocale, initI18n } from '@/lib/i18n';

initI18n(initReactI18next);
applyDocumentLocale();
