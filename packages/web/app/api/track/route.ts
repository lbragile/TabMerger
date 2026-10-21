import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GA_MAX_CLIENT_ID, GA_MAX_PARAMS, GA_MAX_STRING_VALUE, GA_NAME, gaEnvironment, isGa4Configured, sendGa4Event } from '@/lib/ga4'

const bodySchema = z.object({
  event: z.string().regex(GA_NAME),
  client_id: z.string().min(1).max(GA_MAX_CLIENT_ID),
  params: z
    .record(z.string().regex(GA_NAME), z.union([z.string().max(GA_MAX_STRING_VALUE), z.number()]))
    // One slot is reserved for the server-added `environment` param, so the forwarded event
    // never exceeds GA_MAX_PARAMS (GA4 silently drops the extras). A client-sent `environment`
    // is overwritten below, so it doesn't count against the limit.
    .refine((params) => Object.keys(params).filter((key) => key !== 'environment').length <= GA_MAX_PARAMS - 1)
    .optional(),
})

/**
 * Server-side proxy for the extension's GA4 Measurement Protocol events.
 * The extension POSTs here instead of hitting google-analytics.com directly, so the
 * GA4 measurement ID / API secret never ship inside the extension bundle (anyone can
 * unzip an installed extension and read its JS — embedding secrets there is not safe,
 * even for "low sensitivity" data like analytics).
 *
 * Request body: { event: string, params?: Record<string, string | number>, client_id: string }
 * The body is checked against GA4's own naming and size rules (see `bodySchema`); only the
 * three fields above are forwarded, to the `extension` stream (`lib/ga4.ts`), with an
 * `environment` param (`gaEnvironment()`) added to every event.
 * Response: 204 on success or when GA isn't configured (fire-and-forget, matches GA's own
 * response and the extension's no-op-when-unconfigured pattern); 400 for a body that is not
 * JSON or does not fit the rules, without calling GA.
 */
export async function POST(req: NextRequest) {
  if (!isGa4Configured('extension')) return new NextResponse(null, { status: 204 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new NextResponse(null, { status: 400 })
  const { event, params, client_id } = parsed.data

  // Stamp the deployment environment, as uninstallTracking does for extension_uninstalled,
  // so every extension event can be filtered by production/preview/development in GA4.
  await sendGa4Event('extension', {
    clientId: client_id,
    name: event,
    params: { ...params, environment: gaEnvironment() },
  })

  return new NextResponse(null, { status: 204 })
}
