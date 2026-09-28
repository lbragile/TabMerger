import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'
import { FIREFOX_BETA } from '@tabmerger/shared'

/**
 * Public base of the Vercel Blob store CI uploads the self-distributed Firefox beta build to
 * (e.g. `https://<id>.public.blob.vercel-storage.com`) — not a secret, just not worth hardcoding
 * since it's environment-specific (only ever set on the Preview deployment; see
 * docs/PUBLISHING.md). Resolved once at build/boot time, same lifecycle as the rest of this file.
 */
const FIREFOX_BETA_BLOB_BASE_URL = process.env.FIREFOX_BETA_BLOB_BASE_URL

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
  turbopack: {
    // pnpm monorepo fix: Turbopack looks for next/package.json from the workspace root
    // (where pnpm-workspace.yaml lives), not from packages/web. Point to the repo root
    // so it finds node_modules/next that we've hoisted there.
    root: path.resolve(process.cwd(), '../..'),
  },
  // The /changelog route (app/(marketing)/changelog/page.tsx via lib/changelog.ts) reads
  // the repo-root CHANGELOG.md with a *dynamically computed* fs path
  // (path.resolve(process.cwd(), '../..', 'CHANGELOG.md')). Next's build-time file tracer
  // (@vercel/nft) only bundles files it can find via static analysis of imports/requires,
  // so a runtime-computed fs.readFileSync path is invisible to it — without this entry,
  // the deployed Vercel function for this route would never actually have CHANGELOG.md in
  // its bundle, and getGeneratedChangelog() would silently ENOENT-fallback to legacy-only
  // forever, even after semantic-release starts generating the file. This route is also
  // effectively dynamic (not statically generated) because the shared marketing layout's
  // Navbar calls the async Supabase server client, so it re-reads this file per request —
  // all the more reason it needs to be traced into the deployed bundle explicitly.
  //
  // outputFileTracingIncludes' `../../CHANGELOG.md` glob resolves relative to this project
  // directory (packages/web) and points OUTSIDE it, into the monorepo root. Whether Next can
  // honor an include that reaches outside the project directory depends on where it infers
  // the file-tracing root to be. Without an explicit root, Next infers one (usually the pnpm
  // workspace root, found via the lockfile) — confirmed this already resolves correctly with
  // and without this setting (compared .next/server/app/(marketing)/changelog/page.js.nft.json
  // before/after: both contain ../../../../../../../CHANGELOG.md). But relying on inference for
  // a path that reaches outside the project directory is exactly the kind of thing that fails
  // silently (ENOENT -> legacy-only fallback, no build error) if the heuristic ever picks a
  // different root in some environment. Pin it explicitly, mirroring turbopack.root above.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  outputFileTracingIncludes: {
    '/changelog': ['../../CHANGELOG.md'],
  },
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
    // updates.json is what Firefox polls to learn a new beta build exists — if a CDN/browser
    // caches a stale copy, testers silently stop getting updates. Force revalidation regardless
    // of whatever Cache-Control the Blob object itself was uploaded with. The .xpi's own
    // Content-Type (application/x-xpinstall, set by CI on upload per FIREFOX_BETA.XPI_CONTENT_TYPE)
    // passes through the rewrite unmodified, so it's left alone here.
    if (!FIREFOX_BETA_BLOB_BASE_URL) return []
    return [
      {
        source: `${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`,
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Routes Sentry requests through our own origin so ad blockers that target
  // *.ingest.sentry.io (uBlock, Brave Shields, etc.) don't silently drop events.
  tunnelRoute: '/sentry-tunnel',
})
