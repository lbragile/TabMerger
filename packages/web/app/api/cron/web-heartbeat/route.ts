import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'
import { gaEnvironment, isGa4Configured, sendGa4Event, type Ga4Params } from '@/lib/ga4'
import { healthReport } from '@/lib/health'

export const dynamic = 'force-dynamic'

/**
 * A fixed GA4 client id for the heartbeat, so it shows up as one client per deployment
 * environment instead of a new "user" every run.
 */
export const WEB_HEARTBEAT_CLIENT_ID = 'web-heartbeat'

/** Whether the request carries `Authorization: Bearer $CRON_SECRET` (constant-time compare). */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail closed: an unset secret must not open the route to everyone
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * GET /api/cron/web-heartbeat — called by the Vercel cron in `vercel.json` (Vercel sends
 * `Authorization: Bearer $CRON_SECRET`). Sends one `web_heartbeat` event to the web GA4 property
 * with the deployment's health, so a day without the event in GA4 means the site, the cron or the
 * GA pipeline is broken (docs/ANALYTICS.md).
 *
 * 401 without the right bearer (or when `CRON_SECRET` isn't set); 503 when the web GA4 stream
 * isn't configured; 502 when GA refused the event; otherwise 200 `{ sent: true, health }`.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isGa4Configured('web')) return NextResponse.json({ error: 'ga_not_configured' }, { status: 503 })

  const health = await healthReport()
  const params: Ga4Params = { environment: gaEnvironment(), supabase: health.supabase }
  if (health.commit) params.commit = health.commit

  const sent = await sendGa4Event('web', {
    clientId: `${WEB_HEARTBEAT_CLIENT_ID}.${gaEnvironment()}`,
    name: ANALYTICS_EVENTS.webHeartbeat,
    params,
  })
  return NextResponse.json({ sent, health }, { status: sent ? 200 : 502 })
}
