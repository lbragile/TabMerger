import { type NextRequest, type NextResponse } from 'next/server'
import type { AINameGroupResponse } from '@tabmerger/shared'
import { runAiTask, nameGroupTask } from '@/lib/ai'
import { AI_MAX_BODY_BYTES_TAB_LIST, parseNameGroupBody } from '@/lib/ai-validation'
import { aiJson, handleAiRoute } from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). A short answer,
 * even on the largest model with its thinking headroom, takes well under a minute; the model
 * call's own deadline is 20 s earlier (`aiDeadline`), so a slow call times out in our code and
 * releases its credit reservation and concurrency slot.
 */
export const maxDuration = 120

/**
 * Suggests up to 3 different 2-4 word display names for a tab group from its tab titles and URLs.
 * Answers `{ names, name }`: `names` holds 1-3 distinct suggestions, best first, and `name` is
 * `names[0]` for extension builds that read only `name`.
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`); own-key calls send the key in `X-AI-Key` and go to that key's
 * provider, unmetered. Optional body field `model`: `'auto'` or a model id of that provider. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAiRoute(request, {
    action: 'nameGroup',
    label: 'name-group',
    maxDurationSeconds: maxDuration,
    maxBodyBytes: AI_MAX_BODY_BYTES_TAB_LIST,
    parse: parseNameGroupBody,
    run: async (tabs, ctx) => {
      const { result: names, remaining } = await runAiTask(nameGroupTask(tabs), ctx)
      const answer: AINameGroupResponse = { names, name: names[0] }
      return aiJson(answer, remaining)
    },
  })
}
