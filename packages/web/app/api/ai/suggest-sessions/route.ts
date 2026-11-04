import { type NextRequest, type NextResponse } from 'next/server'
import { runAiTask, suggestSessionsTask } from '@/lib/ai'
import { AI_MAX_BODY_BYTES_GROUPS, parseSuggestSessionsBody } from '@/lib/ai-validation'
import { aiJson, handleAiRoute } from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). Organize-sized
 * work over thousands of tabs on the largest model can take minutes; 300 is the Hobby plan's
 * maximum with fluid compute. The model call's own deadline is 20 s earlier (`aiDeadline`), so a
 * slow call times out in our code and releases its credit reservation and concurrency slot.
 */
export const maxDuration = 300

/**
 * Suggests how to consolidate saved groups, naming the groups the suggestion is about.
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`); own-key calls send the key in `X-AI-Key` and go to that key's
 * provider, unmetered. Optional body field `model`: `'auto'` or a model id of that provider. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAiRoute(request, {
    action: 'suggestSessions',
    label: 'suggest-sessions',
    maxDurationSeconds: maxDuration,
    maxBodyBytes: AI_MAX_BODY_BYTES_GROUPS,
    parse: parseSuggestSessionsBody,
    run: async (groups, ctx) => {
      const { result, remaining } = await runAiTask(suggestSessionsTask(groups), ctx)
      // `suggestion` is a deprecated alias for `message`, kept so the currently-shipped
      // extension banner (AIGroupSuggestion) keeps working against a newer server.
      return aiJson({ ...result, suggestion: result.message }, remaining)
    },
  })
}
