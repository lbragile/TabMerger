/**
 * True only on the production deployment (Vercel target `production`, the public site). False on
 * the preview deployment that beta testers use, in local development and in tests.
 *
 * This is the one place the site decides "this is the production deployment". It is not
 * `NODE_ENV`: the preview site is also a production *build*, so `NODE_ENV === 'production'`
 * there too.
 *
 * Reads the environment on each call. `VERCEL_ENV` is the server-side value; the
 * `NEXT_PUBLIC_VERCEL_ENV` copy makes the same check work in a client component. Either one
 * saying `production` is enough.
 *
 * A UI-level switch only (which pages and links exist): never use it to decide access to data or
 * a paid feature.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
}
