import { NextResponse, type NextRequest } from 'next/server'
import type { OrganizeResponse } from '@tabmerger/shared'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { organizeTask, runAiTask, type OrganizePromptGroup } from '@/lib/ai'
import { loadOrganizeGroups, OrganizeNeedsClientDataError } from '@/lib/ai-organize'
import { parseOrganizeBody, readJsonBody } from '@/lib/ai-validation'
import { aiErrorResponse, aiJson, authenticateAiRequest, invalidRequest, resolveAiContext } from '@/lib/ai-route'

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
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  // Read before the plan check and any reservation, so a rejected body never costs anything.
  const body = await readJsonBody(request)
  const input = parseOrganizeBody(body)
  if (!input.ok) return invalidRequest(input.error)

  const ctx = await resolveAiContext(request, auth, body, 'organize')
  if (ctx instanceof NextResponse) return ctx

  let groups: OrganizePromptGroup[]
  try {
    groups = await loadOrganizeGroups(auth.supabase, auth.user.id, input.data)
  } catch (err) {
    if (err instanceof OrganizeNeedsClientDataError) return invalidRequest(err.message)
    return aiErrorResponse(err, 'organize')
  }
  if (groups.length === 0) return invalidRequest('no groups to organize')

  try {
    const { result, remaining } = await runAiTask(organizeTask(groups), ctx)
    const response: OrganizeResponse = { actions: result.actions }
    return aiJson(response, remaining)
  } catch (err) {
    return aiErrorResponse(err, 'organize')
  }
}
