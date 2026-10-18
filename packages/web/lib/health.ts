import { gaEnvironment } from '@/lib/ga4'

/**
 * Liveness facts for `GET /api/health` and the `web_heartbeat` cron: which commit is running,
 * on which deployment, and whether Supabase answers. Nothing here is secret: the commit is public
 * (the source is), and the Supabase check uses only the public URL and publishable key.
 *
 * Server-only.
 */

export type SupabaseStatus = 'ok' | 'down' | 'unconfigured'

export interface HealthReport {
  ok: boolean
  /** Short git commit of the deployment, or `null` outside Vercel. */
  commit: string | null
  environment: string
  /** ISO time the report was made. */
  time: string
  supabase: SupabaseStatus
}

/** How long one Supabase answer is reused, so the public endpoint can't be used to hammer it. */
export const SUPABASE_CHECK_TTL_MS = 60_000
/** A Supabase check that takes longer than this counts as down. */
export const SUPABASE_CHECK_TIMEOUT_MS = 3_000

let cached: { status: SupabaseStatus; at: number } | null = null

/** Test-only: forgets the cached Supabase answer. */
export function _resetHealthCacheForTests(): void {
  cached = null
}

/**
 * Whether Supabase Auth answers its health endpoint (`/auth/v1/health`, one cheap GET that
 * touches no table). Cached for {@link SUPABASE_CHECK_TTL_MS}. Never throws.
 */
export async function checkSupabase(now: number = Date.now()): Promise<SupabaseStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return 'unconfigured'
  if (cached && now - cached.at < SUPABASE_CHECK_TTL_MS) return cached.status
  let status: SupabaseStatus
  try {
    const res = await fetch(new URL('/auth/v1/health', url), {
      headers: { apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(SUPABASE_CHECK_TIMEOUT_MS),
    })
    status = res.ok ? 'ok' : 'down'
  } catch {
    status = 'down'
  }
  cached = { status, at: now }
  return status
}

/** Short (7-character) commit SHA Vercel builds from, or `null` when it isn't set or isn't hex. */
export function deploymentCommit(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null
}

/** The full report. `ok` is false only when Supabase is configured and down. */
export async function healthReport(): Promise<HealthReport> {
  const supabase = await checkSupabase()
  return {
    ok: supabase !== 'down',
    commit: deploymentCommit(),
    environment: gaEnvironment(),
    time: new Date().toISOString(),
    supabase,
  }
}
