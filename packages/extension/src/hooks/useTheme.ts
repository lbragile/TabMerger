import { useEffect } from 'react';
import { applyTheme } from '@/lib/theme';
import { useAppSettings } from '@/hooks/useAppSettings';

/**
 * Applies the saved theme (light/dark/system) whenever it changes — on mount,
 * after a save in the Settings modal (both share the reactive `appSettings`
 * query, so no popup reopen is needed), and when the OS colour scheme changes
 * while the pref is 'system'.
 */
export function useTheme(): void {
  const { data: settings } = useAppSettings();
  const theme = settings?.theme ?? 'system';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (theme === 'system') applyTheme('system');
    };
    mq.addEventListener('change', handleSystemChange);
    return () => mq.removeEventListener('change', handleSystemChange);
  }, [theme]);
}
