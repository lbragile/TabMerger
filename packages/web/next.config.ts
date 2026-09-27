import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

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
}

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Routes Sentry requests through our own origin so ad blockers that target
  // *.ingest.sentry.io (uBlock, Brave Shields, etc.) don't silently drop events.
  tunnelRoute: '/sentry-tunnel',
})
