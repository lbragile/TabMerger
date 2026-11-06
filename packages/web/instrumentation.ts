import type { Instrumentation } from 'next'
import { getServerSentry, serverSentryEnabled } from '@/lib/sentryServer'

/**
 * Runs once when a server process starts. Deliberately empty: server-side Sentry is loaded on
 * first use (lib/sentryServer.ts), not here, so a cold start that serves a static page or a
 * public route doesn't pay for loading the SDK. See lib/sentryServer.ts for what that trades off.
 */
export function register(): void {}

/**
 * Errors thrown while rendering a page or running a route handler, server action or proxy. Loads
 * and initialises server Sentry on the first one (Node.js runtime, DSN set, not an automated test
 * run), then reports it with the route context. `captureRequestError` keeps the function alive
 * until the event is sent. Never throws or rejects: a problem while reporting must not become a
 * second failure on the request that already failed (only a fixed message is logged, no details).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!serverSentryEnabled()) return
  try {
    const Sentry = await getServerSentry()
    await Sentry?.captureRequestError(error, request, context)
  } catch {
    console.error('[TabMerger] Reporting a request error failed')
  }
}
