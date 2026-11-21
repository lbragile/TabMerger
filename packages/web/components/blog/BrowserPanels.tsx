'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { browserPanelId, browserTabId } from '@/lib/blog/browsers'
import { isInstallBrowser, type InstallBrowser } from '@/lib/installBrowser'

const SectionContext = createContext<string>('')

/**
 * The per-browser variants of one article section. `section` is the section's id (listed in the
 * post's `browserSections`, so the switcher's tabs name these panels in `aria-controls`).
 */
export function BrowserPanels({ section, children }: { section: string; children: ReactNode }) {
  return <SectionContext.Provider value={section}>{children}</SectionContext.Provider>
}

/**
 * One browser's variant: a tab panel labelled by its switcher tab. Every browser's panel is in
 * the server HTML (search engines and no-JS readers get all three); the ones for other browsers
 * than the selected one are `hidden`.
 */
export function BrowserPanel({ browser, children }: { browser: InstallBrowser; children: ReactNode }) {
  const section = useContext(SectionContext)
  const { browser: selected } = useBlogPostState()
  if (!isInstallBrowser(browser)) return null
  return (
    <div
      role="tabpanel"
      id={browserPanelId(section, browser)}
      aria-labelledby={browserTabId(browser)}
      hidden={browser !== selected}
    >
      {children}
    </div>
  )
}
