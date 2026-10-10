import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/** GA4's rule for event and parameter names: a letter, then letters, digits or underscores, 40 at most. */
const GA_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
/** GA4's limits on one event: 25 parameters, 100 characters per string value. */
const MAX_PARAMS = 25
const MAX_STRING_VALUE = 100
const MAX_CLIENT_ID = 100

const bodySchema = z.object({
  event: z.string().regex(GA_NAME),
  client_id: z.string().min(1).max(MAX_CLIENT_ID),
  params: z
    .record(z.string().regex(GA_NAME), z.union([z.string().max(MAX_STRING_VALUE), z.number()]))
    .refine((params) => Object.keys(params).length <= MAX_PARAMS)
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
 * three fields above are forwarded.
 * Response: 204 on success or when GA isn't configured (fire-and-forget, matches GA's own
 * response and the extension's no-op-when-unconfigured pattern); 400 for a body that is not
 * JSON or does not fit the rules, without calling GA.
 */
export async function POST(req: NextRequest) {
  const measurementId = process.env.GA_EXTENSION_MEASUREMENT_ID
  const apiSecret = process.env.GA_EXTENSION_API_SECRET
  if (!measurementId || !apiSecret) return new NextResponse(null, { status: 204 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return new NextResponse(null, { status: 400 })
  const { event, params, client_id } = parsed.data

  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: 'POST',
      body: JSON.stringify({ client_id, events: [{ name: event, params }] }),
    }
  ).catch(() => {}) // ponytail: fire-and-forget, GA outage must not surface to the caller

  return new NextResponse(null, { status: 204 })
}
