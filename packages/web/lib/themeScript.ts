/**
 * Inline script that puts the `dark` class on `<html>` before first paint, from the saved theme or
 * the OS preference. A static string (no user input), used by the root layout and by
 * `global-error.tsx`, which renders its own document. An inline script rather than a React effect:
 * an effect runs after hydration and would flash the wrong theme.
 */
export const THEME_KEY = 'theme'

export const noFlashThemeScript = `
try {
  var t = localStorage.getItem('${THEME_KEY}');
  if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {}
`

/** The same decision as `noFlashThemeScript`, for code that runs after React has rendered. */
export function applyStoredTheme(root: HTMLElement = document.documentElement) {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', dark)
  } catch {
    // Storage or matchMedia unavailable: stay on the light theme.
  }
}
