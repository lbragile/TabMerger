import type { InstallBrowser } from '@/lib/installBrowser'

/**
 * The post's browser switcher: its tab order (as the article covers them) and each browser's
 * product name, which is the same in every language.
 */
export const SWITCHER_BROWSERS: readonly InstallBrowser[] = ['chrome', 'edge', 'firefox']

export const BROWSER_NAME: Record<InstallBrowser, string> = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }

/** Id of the switcher tab for `browser`; the panels it controls are labelled by it. */
export function browserTabId(browser: InstallBrowser): string {
  return `blog-browser-tab-${browser}`
}

/** Id of `section`'s panel for `browser` (e.g. `bookmark-edge`). */
export function browserPanelId(section: string, browser: InstallBrowser): string {
  return `${section}-${browser}`
}
