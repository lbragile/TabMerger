import type { AppLocale } from '@/i18n/locales'
import type { Messages } from '@/i18n/messages'

// Typed translation keys: `t('missing.key')` and a wrong namespace fail type-check.
declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale
    Messages: Messages
  }
}
