declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

/** Fires a GA4 custom event via the gtag global exposed by @next/third-parties/google. No-ops if GA isn't configured. */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', name, {
      ...params,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    })
  }
}
