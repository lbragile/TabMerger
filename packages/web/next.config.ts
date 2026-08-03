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
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Routes Sentry requests through our own origin so ad blockers that target
  // *.ingest.sentry.io (uBlock, Brave Shields, etc.) don't silently drop events.
  tunnelRoute: '/sentry-tunnel',
})
