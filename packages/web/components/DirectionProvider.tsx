import { DirectionProvider } from '@radix-ui/react-direction'
import { localeDirection } from '@/i18n/locales'

export { useDirection } from '@radix-ui/react-direction'

/**
 * Gives every Radix primitive the locale's writing direction. Radix doesn't read `<html dir>`:
 * without this context each primitive assumes left-to-right, so in Arabic or Hebrew a dropdown's
 * submenu opened over its parent, arrow-key navigation in tabs and menus ran backwards, the
 * scroll area kept its bar on the right and a select lined its items up on the wrong side.
 *
 * Mounted once in the root layout, from the same locale that sets `<html dir>`. Our own client
 * code reads the same value with `useDirection()` (the reviews carousel), so there is a single
 * source of truth that tests can set by wrapping in Radix's `DirectionProvider`.
 *
 * A server component: `@radix-ui/react-direction` is a client module itself, and there must be
 * exactly one copy of it in the install (it is a direct dependency at the version the primitives
 * use) or the primitives would read a different context.
 */
export function LocaleDirectionProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
  return <DirectionProvider dir={localeDirection(locale)}>{children}</DirectionProvider>
}
