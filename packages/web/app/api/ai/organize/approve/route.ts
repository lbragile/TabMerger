import { NextResponse, type NextRequest } from 'next/server'
import { resumeHook } from 'workflow/api'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { aiDisabledResponse, aiModeDisabledResponse } from '@/lib/ai-guard'
import { parseApproveBody, readJsonBody } from '@/lib/ai-validation'
import { aiError, authenticateAiRequest, invalidRequest, requireProAi } from '@/lib/ai-route'

/**
 * Resumes a paused tab-organizer workflow after the user approves or rejects the proposal.
 * Called by the dashboard OrganizeProposal component via Bearer-token auth. Requires an
 * entitled Pro AI subscription (either option; no model is called, so no BYOK key is needed).
 * Validates the hookToken prefix against the authenticated user ID to prevent IDOR — a forged
 * token for another user's workflow is rejected before reaching the workflow engine.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  // The plan check stays ahead of the body, so an unentitled caller gets 403 for any body.
  const sub = await requireProAi(auth.supabase, auth.user.id)
  if (sub instanceof NextResponse) return sub
  // The caller's own option (managed or own key) must be live, like every other AI request.
  const modeOff = aiModeDisabledResponse(sub.aiMode)
  if (modeOff) return modeOff

  const input = parseApproveBody(await readJsonBody(request))
  if (!input.ok) return invalidRequest(input.error)
  const body = input.data

  // Token format is `org-${userId}-${random}`: a token for another user's run is refused.
  if (!body.token.startsWith(`org-${auth.user.id}-`)) {
    return aiError(403, AI_ERROR_CODES.notFound)
  }

  try {
    await resumeHook(body.token, { approved: body.approved, actions: body.actions })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('AI organize approve error:', err instanceof Error ? err.name : typeof err)
    return aiError(500, AI_ERROR_CODES.failed)
  }
}
