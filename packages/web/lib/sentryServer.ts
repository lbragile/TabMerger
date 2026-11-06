import { scrubEvent } from '@/lib/sentry-scrubber'
import { isAutomatedTestEnvironment } from '@/lib/isAutomatedTestEnvironment'
import { deployEnv } from '@/lib/deployment'

/** The server SDK, as `import('@sentry/nextjs')` resolves it. */
export type ServerSentry = typeof import('@sentry/nextjs')

/**
 * Server-side Sentry, loaded on first use rather than at boot.
 *
 * Loading `@sentry/nextjs` on the server (with @sentry/node and its OpenTelemetry
 * instrumentations) costs several hundred milliseconds of CPU, and `Sentry.init` little on top.
 * Done in `register()`, every cold start of every function paid it, including the ones that only
 * served a static page. Here it is paid by the first request that reports something: a request
 * error (`onRequestError` in instrumentation.ts) or a server-side report such as
 * lib/planChangeAlarm.ts.
 *
 * Accepted trade-off: until something has loaded the SDK in a process, errors raised outside a
 * request (an uncaught exception at boot, a failed background task) are not reported, and
 * breadcrumbs from before that first load are lost. Errors thrown while handling a request are
 * still reported, through `onRequestError`.
 *
 * Every server-side use of `@sentry/nextjs` goes through {@link getServerSentry}; nothing on the
 * server imports it statically. Browser Sentry (instrumentation-client.ts) is separate.
 */

let loading: Promise<ServerSentry | null> | null = null

/**
 * Whether the server reports to Sentry in this process: the Node.js runtime, a DSN configured, and
 * not an automated test run (e2e and visual regression run a real server; their errors must not
 * reach the real project). Nothing in this app runs on the edge runtime.
 */
export function serverSentryEnabled(): boolean {
  return (
    process.env.NEXT_RUNTIME === 'nodejs' && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && !isAutomatedTestEnvironment()
  )
}

/**
 * The initialised server SDK, or null when server reporting is off ({@link serverSentryEnabled})
 * or the SDK failed to load or initialise (it never rejects). Loads and initialises once per
 * process: every caller shares the same promise. A failure is not remembered, so a later call
 * tries again.
 */
export function getServerSentry(): Promise<ServerSentry | null> {
  if (!serverSentryEnabled()) return Promise.resolve(null)
  loading ??= import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: deployEnv(),
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        // The SDK is loaded after the app's modules, so its ESM loader hooks would have nothing
        // left to instrument; registering them only costs start-up time.
        registerEsmLoaderHooks: false,
      })
      return Sentry
    })
    .catch((error: unknown) => {
      // A failed import or init: report nothing this time, and let the next call try again.
      loading = null
      console.error('[TabMerger] Server Sentry failed to load', error)
      return null
    })
  return loading
}
