'use client'

// ponytail: hand-rolled instead of next-themes — the app only needs class
// toggling + localStorage persistence, which is a dozen lines. Add next-themes
// if we ever need system-preference sync or multi-tab broadcast.
//
// Theme is backed entirely by an external store (localStorage/matchMedia) read via
// useSyncExternalStore instead of useState + a mount effect — reading localStorage or
// matchMedia directly during render would crash SSR (no `window`), and syncing that read
// into local state via an effect is exactly the setState-in-effect cascading-render
// pattern the react-hooks lint rule flags. useSyncExternalStore's getServerSnapshot/
// getSnapshot split gives us the SSR-safe read-after-hydration resync for free, and
// toggleTheme writes localStorage + notifies subscribers instead of holding its own state.
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Theme
  toggleTheme: () => void
}>({ theme: 'light', toggleTheme: () => {} })

const THEME_KEY = 'theme'
const listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach((cb) => cb())
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function getSnapshot(): Theme {
  const stored = localStorage.getItem(THEME_KEY) as Theme | null
  return stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

function getServerSnapshot(): Theme {
  return 'light'
}

const subscribeNever = () => () => {}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // False only on the hydration commit, where `theme` is still the server snapshot.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)

  // Updating an external system (the DOM class) from the latest React state — the
  // sanctioned use of useEffect, not the setState-in-effect pattern the rule flags.
  // Skipped on the hydration commit: the inline script in app/layout.tsx has already set the
  // class from the visitor's real theme, and applying the server snapshot ('light') there
  // would strip `dark` for an instant — long enough for the browser to fetch light-only
  // assets (e.g. the hero's light poster) for a dark-theme visitor.
  useEffect(() => {
    if (!hydrated) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [hydrated, theme])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, next)
    notifyListeners()
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
