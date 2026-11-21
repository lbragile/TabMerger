'use client'

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { detectInstallBrowser, type InstallBrowser } from '@/lib/installBrowser'
import { useTheme } from '@/components/theme-provider'
import { mediaMatches } from '@/lib/blog/media'

/**
 * The post page's shared reader choices: which browser's steps and screenshots show (sections 1–3
 * and the rail switch together) and which theme the TabMerger screenshots use.
 *
 * The page is rendered without reading request headers (so it can be cached), so the server HTML
 * assumes Chrome. The reader's own browser is read from `navigator.userAgent` after hydration,
 * through `useSyncExternalStore` (server snapshot: Chrome), with the same rule as the install
 * buttons elsewhere (`detectInstallBrowser`). A click on the switcher overrides it.
 */

type ScreenshotTheme = 'light' | 'dark'

interface BlogPostState {
  /** The reader's browser (Chrome on the server and during hydration). */
  detectedBrowser: InstallBrowser
  /** The browser whose steps show: the reader's pick, else their browser. */
  browser: InstallBrowser
  setBrowser: (browser: InstallBrowser) => void
  /** The reader's screenshot-theme override, or `null` to follow the page theme. */
  screenshotOverride: ScreenshotTheme | null
  /** The screenshot theme in effect (the override, else the page theme). */
  screenshotTheme: ScreenshotTheme
  setScreenshotTheme: (theme: ScreenshotTheme) => void
  /** Sections whose content switches with the browser (the tabs' `aria-controls`). */
  browserSections: readonly string[]
  /** The text of the page's polite live region (shown under the article bar). */
  notice: string
  /** Says something in the live region: Helpful, Share and the copy buttons report here. */
  announce: (message: string) => void
}

const BlogPostContext = createContext<BlogPostState | null>(null)

const subscribeNever = () => () => {}
const readBrowser = () => detectInstallBrowser(navigator.userAgent)
const serverBrowser = (): InstallBrowser => 'chrome'

/** The reader's browser after hydration, Chrome before (and on the server). */
export function useDetectedBrowser(): InstallBrowser {
  return useSyncExternalStore(subscribeNever, readBrowser, serverBrowser)
}

/**
 * Runs a state update inside a View Transition (a short cross-fade, timed in blog.css) when the
 * browser has them and motion isn't reduced; otherwise just runs it.
 */
function withViewTransition(update: () => void) {
  if (typeof document.startViewTransition === 'function' && mediaMatches('(prefers-reduced-motion: no-preference)')) {
    document.startViewTransition(() => flushSync(update))
  } else {
    update()
  }
}

export function BlogPostStateProvider({
  browserSections = [],
  children,
}: {
  browserSections?: readonly string[]
  children: ReactNode
}) {
  const detectedBrowser = useDetectedBrowser()
  const [picked, setPicked] = useState<InstallBrowser | null>(null)
  const { theme } = useTheme()
  const [screenshotOverride, setScreenshotOverride] = useState<ScreenshotTheme | null>(null)
  const [notice, setNotice] = useState('')
  return (
    <BlogPostContext.Provider
      value={{
        detectedBrowser,
        browser: picked ?? detectedBrowser,
        setBrowser: (next) => withViewTransition(() => setPicked(next)),
        screenshotOverride,
        screenshotTheme: screenshotOverride ?? theme,
        setScreenshotTheme: (next) => withViewTransition(() => setScreenshotOverride(next)),
        browserSections,
        notice,
        // The same text twice in a row is still announced: clear, then set on the next frame.
        announce: (message) => {
          setNotice('')
          requestAnimationFrame(() => setNotice(message))
        },
      }}
    >
      {children}
    </BlogPostContext.Provider>
  )
}

/**
 * The post page's state. Outside a provider (a component rendered on its own, in a test) it is a
 * fixed Chrome / page-theme state whose setters do nothing.
 */
export function useBlogPostState(): BlogPostState {
  const state = useContext(BlogPostContext)
  const detectedBrowser = useDetectedBrowser()
  const { theme } = useTheme()
  return (
    state ?? {
      detectedBrowser,
      browser: detectedBrowser,
      setBrowser: () => {},
      screenshotOverride: null,
      screenshotTheme: theme,
      setScreenshotTheme: () => {},
      browserSections: [],
      notice: '',
      announce: () => {},
    }
  )
}
