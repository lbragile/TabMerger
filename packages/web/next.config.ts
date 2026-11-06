import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs/config'
import createNextIntlPlugin from 'next-intl/plugin'
import { FIREFOX_BETA } from '@tabmerger/shared'
import { deployEnv, isPreviewDeployment } from './lib/deployment'
import { generateChangelogModule } from './scripts/generate-changelog.mjs'

// /changelog's release notes are compiled in from the repo-root CHANGELOG.md (no runtime file
// read). Done here so every `next dev` and `next build` refreshes them, whatever command runs
// Next; throws, failing the build, when CHANGELOG.md is missing.
generateChangelogModule()

/**
 * Public base of the Vercel Blob store CI uploads the self-distributed Firefox beta build to
 * (e.g. `https://<id>.public.blob.vercel-storage.com`) — not a secret, just not worth hardcoding
 * since it's environment-specific (only ever set on the Preview deployment; see
 * docs/PUBLISHING.md). Resolved once at build/boot time, same lifecycle as the rest of this file.
 */
const FIREFOX_BETA_BLOB_BASE_URL = process.env.FIREFOX_BETA_BLOB_BASE_URL

/**
 * Values written into the bundles at build time (server and browser alike, wherever the exact
 * `process.env.NAME` appears):
 * - `NEXT_PUBLIC_DEPLOY_ENV`: the deployment environment for browser code (analytics, Sentry,
 *   PostHog), derived here from `DEPLOY_ENV`, else Vercel's `VERCEL_ENV`, so a deploy sets one
 *   variable for server and browser alike. Always defined: `development` locally.
 * - `DEPLOY_COMMIT_SHA` / `DEPLOY_COMMIT_REF`: only when set for the build, so a host can stamp
 *   the commit once at build time. Unset, server code keeps reading them (or Vercel's
 *   `VERCEL_GIT_COMMIT_*`) at runtime.
 */
export function buildTimeEnv(): Record<string, string> {
  const env: Record<string, string> = { NEXT_PUBLIC_DEPLOY_ENV: deployEnv() }
  for (const name of ['DEPLOY_COMMIT_SHA', 'DEPLOY_COMMIT_REF'] as const) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  return env
}

/**
 * `X-Robots-Tag: noindex` on every response of the preview deployment (the beta testers' site),
 * so it never competes with production in search results. Hosts don't add one there.
 *
 * Only the preview environment (`isPreviewDeployment()`), not "anything but production": local
 * development and CI's `next start` (Lighthouse scores the SEO category, including is-crawlable)
 * have no deployment environment and must stay indexable. Evaluated when the site is built; the
 * preview and production sites are separate builds, each with its own `DEPLOY_ENV` (or
 * `VERCEL_ENV`). A header rather than a robots meta tag, so a 404 still carries exactly one meta.
 */
export function previewNoindexHeaders(): { source: string; headers: { key: string; value: string }[] }[] {
  if (!isPreviewDeployment()) return []
  return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }]
}

/**
 * Builds the `/firefox-beta/*` → Blob store rewrite, or `null` when unconfigured so the app runs
 * fine on deployments that never got the beta channel set up (local dev, production). Exported
 * for a focused unit test rather than only exercised indirectly through next.config.ts.
 */
export function firefoxBetaRewrite(baseUrl: string | undefined) {
  if (!baseUrl) return null
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    console.warn('[TabMerger] FIREFOX_BETA_BLOB_BASE_URL is not a valid URL — Firefox beta rewrite disabled')
    return null
  }
  if (parsed.protocol !== 'https:') {
    console.warn('[TabMerger] FIREFOX_BETA_BLOB_BASE_URL must be https — Firefox beta rewrite disabled')
    return null
  }
  // Strip any trailing slash so the destination doesn't end up with `//` before the path segment.
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  return {
    source: `${FIREFOX_BETA.PATH}/:file`,
    destination: `${normalizedBase}${FIREFOX_BETA.PATH}/:file`,
  }
}

const nextConfig: NextConfig = {
  // The source is public (LICENSE.md), so serving source maps exposes nothing and lets browsers
  // and Lighthouse map the large first-party bundles back to it.
  productionBrowserSourceMaps: true,
  turbopack: {
    // pnpm monorepo fix: Turbopack looks for next/package.json from the workspace root
    // (where pnpm-workspace.yaml lives), not from packages/web. Point to the repo root
    // so it finds node_modules/next that we've hoisted there.
    root: path.resolve(process.cwd(), '../..'),
  },
  // Pinned to the monorepo root, like turbopack.root, so file tracing never has to guess it.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  env: buildTimeEnv(),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
    // Next only allows `quality` values present in this list (default: [75]).
    // The beta page's screenshots pass quality={90} to avoid re-encoding UI
    // text/screenshots down to the point of visible blur — 90 must be
    // explicitly allow-listed here or that prop throws at request time.
    qualities: [75, 90],
  },
  async rewrites() {
    const rewrite = firefoxBetaRewrite(FIREFOX_BETA_BLOB_BASE_URL)
    return rewrite ? [rewrite] : []
  },
  async headers() {
    const rules = previewNoindexHeaders()
    // updates.json is what Firefox polls to learn a new beta build exists — if a CDN/browser
    // caches a stale copy, testers silently stop getting updates. Force revalidation regardless
    // of whatever Cache-Control the Blob object itself was uploaded with. The .xpi's own
    // Content-Type (application/x-xpinstall, set by CI on upload per FIREFOX_BETA.XPI_CONTENT_TYPE)
    // passes through the rewrite unmodified, so it's left alone here.
    if (FIREFOX_BETA_BLOB_BASE_URL) {
      rules.push({
        source: `${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`,
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      })
    }
    return rules
  },
}

// next-intl: points the `next-intl/server` APIs at the per-request config (locale + catalog).
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  // Routes Sentry requests through our own origin so ad blockers that target
  // *.ingest.sentry.io (uBlock, Brave Shields, etc.) don't silently drop events.
  tunnelRoute: '/sentry-tunnel',
})
