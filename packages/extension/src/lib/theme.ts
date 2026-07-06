/**
 * Theme utilities — apply/read the saved theme preference.
 * applyTheme() must be callable outside React (e.g. in App mount) so it lives
 * here rather than inside the hook.
 */

export type AppTheme = 'light' | 'dark' | 'system';

/** Toggle the Tailwind `.dark` class on <html> based on the resolved theme.
 *  Also writes the preference to localStorage so the inline script in
 *  popup/index.html can apply the class synchronously before React mounts,
 *  preventing a flash of incorrect theme on popup open. */
export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  // Persist to localStorage for synchronous read on next popup open
  try { localStorage.setItem('tabmerger-theme', theme); } catch { /* storage may be unavailable */ }
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    // 'system' — follow the OS preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
}
