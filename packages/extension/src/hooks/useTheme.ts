import { useEffect } from 'react';
import { getSetting } from '@/lib/localDb';
import { applyTheme, type AppTheme } from '@/lib/theme';

/**
 * On mount: reads the saved theme from IndexedDB and applies it (no flash).
 * Registers a matchMedia listener so 'system' mode updates live when the OS
 * theme changes.  Call once near the app root.
 */
export function useTheme(): void {
  useEffect(() => {
    let cancelled = false;

    // Read saved preference and apply before first paint
    getSetting<{ theme?: AppTheme }>('appSettings', {}).then((settings) => {
      if (!cancelled) {
        applyTheme(settings.theme ?? 'system');
      }
    });

    // Watch OS colour-scheme changes; only acts when pref is 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      getSetting<{ theme?: AppTheme }>('appSettings', {}).then((settings) => {
        if (settings.theme === 'system' || !settings.theme) {
          applyTheme('system');
        }
      });
    };

    mq.addEventListener('change', handleSystemChange);
    return () => {
      cancelled = true;
      mq.removeEventListener('change', handleSystemChange);
    };
  }, []);
}
