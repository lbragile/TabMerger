import 'i18next';
import type { Catalog } from './locales/en';

// Typed keys: `t('header.undo')` checks against the English catalog, so a missing key fails tsc.
declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'translation';
        resources: { translation: Catalog };
    }
}
