import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GA_MAX_CLIENT_ID, GA_MAX_PARAMS, GA_MAX_STRING_VALUE, GA_NAME, gaEnvironment, isGa4Configured, sendGa4Event } from '@/lib/ga4'
import { readJsonBodyWithin } from '@/lib/ai-validation'

/**
 * Largest body accepted, whatever its content type. The biggest valid event (a 40-character name,
 * a 100-character client id, 24 params of 40-character names and 100-character values) is under
 * 16 KB even with every character JSON-escaped; anything over this cap can't pass `bodySchema`.
 */
export const TRACK_MAX_BODY_BYTES = 32 * 1024

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
 * as JSON text, sent as `Content-Type: text/plain` (a CORS "simple request": the browser sends no
 * OPTIONS preflight first, so one event is one function invocation) or, from older extension
 * builds, `application/json`. The body is parsed as JSON whatever the content type, and read with
 * the same cap ({@link TRACK_MAX_BODY_BYTES}) either way. The extension CORS headers are added
 * by proxy.ts for both.
 * The body is checked against GA4's own naming and size rules (see `bodySchema`); only the
 * three fields above are forwarded, to the `extension` stream (`lib/ga4.ts`), with an
 * `environment` param (`gaEnvironment()`) added to every event.
 * Response: 204 on success or when GA isn't configured (fire-and-forget, matches GA's own
 * response and the extension's no-op-when-unconfigured pattern); 400 for a body that is not
 * JSON or does not fit the rules, 413 for one over the cap and 408 for one that doesn't arrive in
 * time, all without calling GA.
 */
export async function POST(req: NextRequest) {
  if (!isGa4Configured('extension')) return new NextResponse(null, { status: 204 })

  const body = await readJsonBodyWithin(req, TRACK_MAX_BODY_BYTES)
  if (!body.ok) return new NextResponse(null, { status: body.reason === 'too_large' ? 413 : 408 })
  const parsed = bodySchema.safeParse(body.body)
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
