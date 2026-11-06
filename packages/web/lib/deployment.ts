/**
 * Where this copy of the site runs: the one place that reads the hosting platform's variables.
 * Everything else asks these helpers instead of reading `VERCEL_*` (or any other host's names)
 * itself, so moving host means changing only this file and the deploy configuration.
 *
 * Each value has a host-neutral variable that wins, then today's Vercel system variable:
 *
 * | Helper                  | Neutral variable                       | Vercel fallback         |
 * | ----------------------- | -------------------------------------- | ----------------------- |
 * | {@link deployEnv}       | `DEPLOY_ENV` (runtime)                 | `VERCEL_ENV`            |
 * | {@link clientDeployEnv} | `NEXT_PUBLIC_DEPLOY_ENV` (build)       | derived in next.config  |
 * | {@link deployCommitSha} | `DEPLOY_COMMIT_SHA` (build or runtime) | `VERCEL_GIT_COMMIT_SHA` |
 * | {@link deployCommitRef} | `DEPLOY_COMMIT_REF` (build or runtime) | `VERCEL_GIT_COMMIT_REF` |
 * | {@link deploymentId}    | none                                   | `VERCEL_DEPLOYMENT_ID`  |
 * | {@link deployPlatform}  | `DEPLOY_PLATFORM` (runtime)            | `VERCEL=1`              |
 *
 * An empty string counts as unset (tests stub variables to `''`).
 */

/** The three deployments the site knows: the public site, the beta testers' site, and the rest. */
export const DEPLOY_ENVS = ['production', 'preview', 'development'] as const
export type DeployEnv = (typeof DEPLOY_ENVS)[number]

/**
 * The request headers one hosting platform's edge sets on every incoming request, overwriting any
 * copy the client sent. Only the current platform's names are trusted ({@link deployPlatform}).
 */
export interface EdgeProvider {
  /** Headers holding the client's address, in the order to try: the first one present wins. */
  readonly clientIp: readonly string[]
  /** Geo-IP country (ISO 3166-1 alpha-2). */
  readonly country: string
  /** Geo-IP subdivision (`QC`, or a full `CA-QC`). */
  readonly region: string
}

/**
 * Every hosting platform the server knows, keyed by its `DEPLOY_PLATFORM` name. Supporting a new
 * host is one entry here (and its name in the deploy configuration): `lib/clientIp.ts` and
 * `lib/consentRegions.ts` read their header names from this table.
 *
 * - `cloudflare`: `cf-connecting-ip` only. `cf-region-code` needs the zone's "Add visitor location
 *   headers" Managed Transform; without it the country alone decides, and Quebec falls back to
 *   Canada's opt-out.
 * - `vercel`: `x-vercel-forwarded-for` first, because a proxy in front of Vercel could change
 *   `x-forwarded-for`; then `x-real-ip`, then `x-forwarded-for`. Vercel overwrites all three and
 *   doesn't forward a client-sent copy.
 */
export const EDGE_PROVIDERS = {
  cloudflare: { clientIp: ['cf-connecting-ip'], country: 'cf-ipcountry', region: 'cf-region-code' },
  vercel: {
    clientIp: ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'],
    country: 'x-vercel-ip-country',
    region: 'x-vercel-ip-country-region',
  },
} as const satisfies Record<string, EdgeProvider>

/** Hosting platforms whose request headers the server knows how to trust. */
export type DeployPlatform = keyof typeof EDGE_PROVIDERS
export const DEPLOY_PLATFORMS = Object.keys(EDGE_PROVIDERS) as readonly DeployPlatform[]

/**
 * Off any platform (local development, CI), the order in which each platform's geo headers are
 * tried. The e2e tests send Vercel's names.
 */
export const OFF_PLATFORM_GEO_ORDER: readonly DeployPlatform[] = ['vercel', 'cloudflare']

/** Whether `value` names a platform in {@link EDGE_PROVIDERS}. */
export function isDeployPlatform(value: string | undefined): value is DeployPlatform {
  return value !== undefined && Object.hasOwn(EDGE_PROVIDERS, value)
}

/** `value` when it names a known deployment, else `development` (local, CI, tests, typos). */
export function normalizeDeployEnv(value: string | undefined): DeployEnv {
  return value === 'production' || value === 'preview' ? value : 'development'
}

/**
 * The deployment environment name as configured, before normalising: `DEPLOY_ENV`, else
 * `VERCEL_ENV`, else the build-time `NEXT_PUBLIC_DEPLOY_ENV`. Undefined when none is set (local
 * development, CI, tests). Server-side reads happen per call, so tests can stub them.
 */
export function rawDeployEnv(): string | undefined {
  return process.env.DEPLOY_ENV || process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_DEPLOY_ENV || undefined
}

/**
 * The deployment environment on the server: `production`, `preview`, or `development` for
 * anything else. Falls back to the build-time value, so a host that sets `DEPLOY_ENV` only for
 * the build still answers correctly at runtime.
 */
export function deployEnv(): DeployEnv {
  return normalizeDeployEnv(rawDeployEnv())
}

/**
 * The deployment environment in code that also runs in the browser (analytics, Sentry,
 * PostHog). `NEXT_PUBLIC_DEPLOY_ENV` is written into the bundles once, in next.config.ts, from
 * `DEPLOY_ENV` or `VERCEL_ENV` at build time; the property access must stay literal for Next to
 * inline it.
 */
export function clientDeployEnv(): DeployEnv {
  return normalizeDeployEnv(process.env.NEXT_PUBLIC_DEPLOY_ENV)
}

/**
 * True only on the production deployment (the public site). False on the preview deployment
 * that beta testers use, in local development and in tests.
 *
 * This is the one place the site decides "this is the production deployment". It is not
 * `NODE_ENV`: the preview site is also a production *build*, so `NODE_ENV === 'production'`
 * there too.
 *
 * Prefer calling it on the server (a server component, a route) and passing the answer, or what
 * follows from it, down to client components as props. `lib/storeLinks.ts` does this for the
 * install links.
 *
 * A UI-level switch only (which pages and links exist): never use it to decide access to data or
 * a paid feature.
 */
export function isProductionDeployment(): boolean {
  return deployEnv() === 'production'
}

/**
 * True only on the preview deployment (the beta testers' site). Not simply
 * `!isProductionDeployment()`: local development and CI's `next start` (Lighthouse) have no
 * deployment environment at all and must behave like the public site for crawl checks.
 */
export function isPreviewDeployment(): boolean {
  return deployEnv() === 'preview'
}

/**
 * True when anything says this process runs on a hosted deployment: a deployment environment or
 * a platform is set, under the neutral or the Vercel names. Dev-only switches (the AI mock) use
 * it to refuse to turn on anywhere but a developer's own machine. Deliberately broader than
 * {@link deployEnv}: even `DEPLOY_ENV=development` counts, because a hosted copy set it.
 */
export function isHostedDeployment(): boolean {
  return Boolean(
    process.env.DEPLOY_ENV ||
      process.env.DEPLOY_PLATFORM ||
      process.env.VERCEL_ENV ||
      process.env.VERCEL ||
      deployEnv() !== 'development'
  )
}

/**
 * The full commit SHA this deployment was built from: `DEPLOY_COMMIT_SHA`, else Vercel's
 * `VERCEL_GIT_COMMIT_SHA`. Undefined locally. Not validated here; callers that show it check it
 * is hex (`lib/health.ts`).
 */
export function deployCommitSha(): string | undefined {
  return process.env.DEPLOY_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || undefined
}

/**
 * The branch (or tag) this deployment was built from: `DEPLOY_COMMIT_REF`, else Vercel's
 * `VERCEL_GIT_COMMIT_REF`. Undefined when unknown. Diagnostics only.
 */
export function deployCommitRef(): string | undefined {
  return process.env.DEPLOY_COMMIT_REF || process.env.VERCEL_GIT_COMMIT_REF || undefined
}

/**
 * The host's own ID for this deployment, for finding it in the host's dashboard: Vercel's
 * `VERCEL_DEPLOYMENT_ID`. Other hosts don't expose one as a variable, so it is undefined there
 * and diagnostics leave the line out. Diagnostics only.
 */
export function deploymentId(): string | undefined {
  return process.env.VERCEL_DEPLOYMENT_ID || undefined
}

/**
 * The hosting platform, which decides which request headers the server may trust (client IP,
 * geo). `DEPLOY_PLATFORM` when it names an {@link EDGE_PROVIDERS} entry; else `vercel` when Vercel's own
 * `VERCEL=1` is set; else null (local development, CI, tests), where every header is whatever
 * the client sent.
 */
export function deployPlatform(): DeployPlatform | null {
  const configured = process.env.DEPLOY_PLATFORM
  if (isDeployPlatform(configured)) return configured
  if (process.env.VERCEL === '1') return 'vercel'
  return null
}
