import { NextResponse } from 'next/server'
import { healthReport } from '@/lib/health'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — public liveness check for uptime monitors.
 * Response: `{ ok, commit, environment, time, supabase }` (see `lib/health.ts`), never cached.
 * 200 when healthy, 503 when Supabase is configured but doesn't answer. No secrets, no user data.
 */
export async function GET() {
  const report = await healthReport()
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
