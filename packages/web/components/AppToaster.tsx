'use client'

import type { CSSProperties } from 'react'
import { Toaster } from 'sonner'
import { useTheme } from '@/components/theme-provider'

// Mix a token into the page surface instead of using alpha: a toast floats over content, so a
// translucent background would let the page show through it.
const tint = (token: string, percent: number) =>
  `color-mix(in srgb, hsl(var(${token})) ${percent}%, hsl(var(--surface)))`

/**
 * How long a toast stays up (sonner's default is 4s, short for a sentence). The same value
 * drives the countdown bar in globals.css through `--toast-duration`, so the bar always empties
 * exactly when sonner dismisses the toast.
 */
export const TOAST_DURATION_MS = 6000

/**
 * Sonner draws toasts with its own palette, 8px corners and system font. These overrides feed it
 * the app's tokens instead, so toasts match the in-page notices (e.g. `UpgradedBanner`): same
 * square corners, font, and success/error colors, in both themes. Set inline because sonner
 * injects its stylesheet at runtime, after ours, and defines these variables on this element.
 */
const TOKENS = {
  fontFamily: 'inherit',
  '--toast-duration': `${TOAST_DURATION_MS}ms`,
  '--border-radius': 'var(--radius)',
  // Contrast (measured on /pricing, both themes): the border is what separates a toast from the
  // page, so it clears WCAG's 3:1 for component edges; text is the plain foreground colour for
  // the strongest contrast, and the icon, border and countdown bar carry success/error colour.
  '--normal-bg': 'hsl(var(--popover))',
  '--normal-border': tint('--foreground', 50),
  '--normal-text': 'hsl(var(--popover-foreground))',
  '--success-bg': tint('--ok', 14),
  '--success-border': 'hsl(var(--ok))',
  '--success-text': 'hsl(var(--foreground))',
  '--error-bg': tint('--destructive', 14),
  '--error-border': 'hsl(var(--destructive))',
  '--error-text': 'hsl(var(--foreground))',
  // The dismiss button's position and look are in globals.css (inside the top-right corner).
} as CSSProperties

export function AppToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      theme={theme}
      richColors
      closeButton
      position="bottom-right"
      duration={TOAST_DURATION_MS}
      style={TOKENS}
    />
  )
}
