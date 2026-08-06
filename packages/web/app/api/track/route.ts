import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side proxy for the extension's GA4 Measurement Protocol events.
 * The extension POSTs here instead of hitting google-analytics.com directly, so the
 * GA4 measurement ID / API secret never ship inside the extension bundle (anyone can
 * unzip an installed extension and read its JS — embedding secrets there is not safe,
 * even for "low sensitivity" data like analytics).
 *
 * Request body: { event: string, params?: Record<string, string | number>, client_id: string }
 * Response: 204 on success or when GA isn't configured (fire-and-forget, matches GA's own
 * response and the extension's no-op-when-unconfigured pattern).
 */
export async function POST(req: NextRequest) {
  const measurementId = process.env.GA_EXTENSION_MEASUREMENT_ID
  const apiSecret = process.env.GA_EXTENSION_API_SECRET
  if (!measurementId || !apiSecret) return new NextResponse(null, { status: 204 })

  const { event, params, client_id } = await req.json()

  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: 'POST',
      body: JSON.stringify({ client_id, events: [{ name: event, params }] }),
    }
  ).catch(() => {}) // ponytail: fire-and-forget, GA outage must not surface to the caller

  return new NextResponse(null, { status: 204 })
}
