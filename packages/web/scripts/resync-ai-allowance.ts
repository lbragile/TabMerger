/**
 * One-off: recompute `subscriptions.ai_mode` and `ai_monthly_credits` for every `pro_ai` row from
 * Stripe, with the same function the webhook uses (lib/aiAllowance.ts). Run once per environment
 * after migration 022 and the code that writes these columns are deployed; running it again is
 * harmless (only rows whose values differ are written).
 *
 * Dry run by default; `--apply` writes. Prints counts and Stripe subscription ids only.
 *
 *   cd packages/web
 *   pnpm dlx tsx --env-file=<env file with the target environment's values> scripts/resync-ai-allowance.ts
 *   pnpm dlx tsx --env-file=<same file> scripts/resync-ai-allowance.ts --apply
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (same mode as the
 * project: test keys for preview, live for production) and the six STRIPE_PRO*_PRICE_ID vars.
 * Relative imports only, so it runs under plain tsx without Next.js.
 */
import { createClient } from '@supabase/supabase-js'
import { isStripeConfigured, stripe } from '../lib/stripe'
import { resyncAiAllowances } from '../lib/aiAllowanceResync'

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_PRO_AI_MONTHLY_PRICE_ID',
  'STRIPE_PRO_AI_YEARLY_PRICE_ID',
] as const

async function main() {
  const apply = process.argv.includes('--apply')
  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  if (!isStripeConfigured || missing.length) {
    console.error(`Missing env: ${[...(isStripeConfigured ? [] : ['STRIPE_SECRET_KEY']), ...missing].join(', ')}`)
    process.exit(1)
  }
  for (const name of ['STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID']) {
    if (!process.env[name]) console.warn(`Warning: ${name} is not set; a BYOK subscription would read as an unknown price (0 credits).`)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  console.log(apply ? 'Applying changes.' : 'Dry run: nothing is written (pass --apply to write).')
  const result = await resyncAiAllowances({ stripe, supabase, apply, log: (line) => console.log(line) })

  console.log(
    `pro_ai rows: ${result.scanned}; unchanged: ${result.unchanged}; ${apply ? 'written' : 'would change'}: ${result.changed.length}; skipped: ${result.skipped.length}; failed: ${result.failed.length}`
  )
  if (result.skipped.length) console.log(`Skipped (no Stripe subscription): ${result.skipped.join(', ')}`)
  if (result.failed.length) {
    console.log(`Failed (run again): ${result.failed.join(', ')}`)
    process.exit(2)
  }
}

main().catch((err: unknown) => {
  console.error('Re-sync stopped:', err instanceof Error ? err.message : 'unknown error')
  process.exit(1)
})
