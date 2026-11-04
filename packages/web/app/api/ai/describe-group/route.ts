import { type NextRequest, type NextResponse } from 'next/server'
import { describeGroupTask, runAiTask } from '@/lib/ai'
import { AI_MAX_BODY_BYTES_TAB_LIST, parseDescribeGroupBody } from '@/lib/ai-validation'
import { aiJson, handleAiRoute } from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). A short answer,
 * even on the largest model with its thinking headroom, takes well under a minute; the model
 * call's own deadline is 20 s earlier (`aiDeadline`), so a slow call times out in our code and
 * releases its credit reservation and concurrency slot.
 */
export const maxDuration = 120

/**
 * Describes a saved group in 1-3 plain sentences (at most `AI_MAX_GROUP_DESCRIPTION_LENGTH`
 * characters), which the extension writes into the group's note. Body:
 * `{ groupName, tabs: { title, url }[], model? }` (`AIDescribeGroupRequest`); answer
 * `{ description }` (`AIDescribeGroupResponse`).
 *
 * The group name and tabs come decrypted from the client: group content in Supabase is
 * end-to-end encrypted, so this route never reads it from the database.
 *
 * Called by the extension with its Supabase JWT as a Bearer token. Requires an entitled Pro AI
 * subscription; managed calls are metered in credits (the balance comes back in
 * `X-AI-Credits-Remaining`); own-key calls send the key in `X-AI-Key` and go to that key's
 * provider, unmetered. Optional body field `model`: `'auto'` or a model id of that provider. Request flow: see `lib/ai-route.ts`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAiRoute(request, {
    action: 'describeGroup',
    label: 'describe-group',
    maxDurationSeconds: maxDuration,
    maxBodyBytes: AI_MAX_BODY_BYTES_TAB_LIST,
    parse: parseDescribeGroupBody,
    run: async (group, ctx) => {
      const { result, remaining } = await runAiTask(describeGroupTask(group), ctx)
      return aiJson({ description: result }, remaining)
    },
  })
}
