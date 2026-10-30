import { type NextRequest, type NextResponse } from 'next/server'
import { runAiTask, tabSummaryTask } from '@/lib/ai'
import { AI_MAX_BODY_BYTES_ONE_TAB, parseTabSummaryBody } from '@/lib/ai-validation'
import { aiJson, handleAiRoute } from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). A short answer,
 * even on the largest model with its thinking headroom, takes well under a minute; the model
 * call's own deadline is 20 s earlier (`aiDeadline`), so a slow call times out in our code and
 * releases its credit reservation and concurrency slot.
 */
export const maxDuration = 120

/**
 * Summarizes one tab in 1-2 sentences from its title and URL, for the hover preview.
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`); own-key calls send the key in `X-AI-Key` and go to that key's
 * provider, unmetered. Optional body field `model`: `'auto'` or a model id of that provider. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAiRoute(request, {
    action: 'tabSummary',
    label: 'tab-summary',
    maxDurationSeconds: maxDuration,
    maxBodyBytes: AI_MAX_BODY_BYTES_ONE_TAB,
    parse: parseTabSummaryBody,
    run: async (tab, ctx) => {
      const { result, remaining } = await runAiTask(tabSummaryTask(tab), ctx)
      return aiJson({ summary: result }, remaining)
    },
  })
}
