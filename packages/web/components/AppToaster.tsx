'use client'

import type { CSSProperties } from 'react'
import { Toaster } from 'sonner'
import { useTheme } from '@/components/theme-provider'

// Mix a token into the page surface instead of using alpha: a toast floats over content, so a
// translucent background would let the page show through it.
const tint = (token: string, percent: number) =>
  `color-mix(in srgb, hsl(var(${token})) ${percent}%, hsl(var(--surface)))`

/**
 * Sonner draws toasts with its own palette, 8px corners and system font. These overrides feed it
 * the app's tokens instead, so toasts match the in-page notices (e.g. `UpgradedBanner`): same
 * square corners, font, and success/error colors, in both themes. Set inline because sonner
 * injects its stylesheet at runtime, after ours, and defines these variables on this element.
 */
const TOKENS = {
  fontFamily: 'inherit',
  '--border-radius': 'var(--radius)',
  '--normal-bg': 'hsl(var(--popover))',
  '--normal-border': 'hsl(var(--border))',
  '--normal-text': 'hsl(var(--popover-foreground))',
  '--success-bg': 'hsl(var(--ok-soft))',
  '--success-border': tint('--ok', 30),
  '--success-text': 'hsl(var(--ok))',
  '--error-bg': tint('--destructive', 10),
  '--error-border': tint('--destructive', 30),
  '--error-text': 'hsl(var(--destructive))',
  // Dismiss button on the right, like the banners' (sonner defaults to top-left).
  '--toast-close-button-start': 'unset',
  '--toast-close-button-end': '0',
  '--toast-close-button-transform': 'translate(35%, -35%)',
} as CSSProperties

export function AppToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} richColors closeButton position="bottom-right" style={TOKENS} />
}
