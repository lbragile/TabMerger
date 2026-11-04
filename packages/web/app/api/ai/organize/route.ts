import { type NextRequest, type NextResponse } from 'next/server'
import type { OrganizeResponse } from '@tabmerger/shared'
import { organizeTask, runAiTask } from '@/lib/ai'
import { loadOrganizeGroups, OrganizeNeedsClientDataError } from '@/lib/ai-organize'
import { AI_MAX_BODY_BYTES_GROUPS, parseOrganizeBody } from '@/lib/ai-validation'
import { aiJson, handleAiRoute, invalidRequest } from '@/lib/ai-route'

/**
 * Seconds Vercel lets this function run (a literal: Next reads it statically). Organize-sized
 * work over thousands of tabs on the largest model can take minutes; 300 is the Hobby plan's
 * maximum with fluid compute. The model call's own deadline is 20 s earlier (`aiDeadline`), so a
 * slow call times out in our code and releases its credit reservation and concurrency slot.
 */
export const maxDuration = 300

/**
 * Proposes a reorganization of the caller's tab groups: `{ actions }` (merge / rename / delete /
 * reorder, see `OrganizeAction`), which the extension shows for review and applies locally.
 *
 * A synchronous AI route like the others: metered in managed mode, on the customer's key in
 * BYOK mode, structured output cleaned by `sanitizeOrganizeProposal` (only ids from the request,
 * never a permanent group in merge / rename / delete, names cleaned and capped). Nothing is
 * stored and nothing is written: the server could not merge or rename an end-to-end encrypted
 * group anyway, since it holds no key.
 *
 * Group data: end-to-end encrypted users must send their locally decrypted groups in the
 * body, because `groups.windows` in Supabase is ciphertext the server can never read. Only a
 * request that sends no groups (no JSON object, or `groups` missing, null or empty) reads the
 * stored rows; sent groups are used or rejected with a 400, never replaced by the stored rows,
 * and stored rows that turn out to be encrypted end the request with a 400 before the model is
 * called.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAiRoute(request, {
    action: 'organize',
    label: 'organize',
    maxDurationSeconds: maxDuration,
    maxBodyBytes: AI_MAX_BODY_BYTES_GROUPS,
    parse: parseOrganizeBody,
    run: async (input, ctx, auth) => {
      let groups
      try {
        groups = await loadOrganizeGroups(auth.supabase, auth.user.id, input)
      } catch (err) {
        if (err instanceof OrganizeNeedsClientDataError) return invalidRequest(err.message)
        throw err
      }
      if (groups.length === 0) return invalidRequest('no groups to organize')

      const { result, remaining } = await runAiTask(organizeTask(groups), ctx)
      const response: OrganizeResponse = { actions: result.actions }
      return aiJson(response, remaining)
    },
  })
}
