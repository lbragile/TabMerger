import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { start, getRun } from 'workflow/api'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { aiDisabledResponse } from '@/lib/ai-guard'
import { organizeTask, runAiTask, type OrganizePromptGroup, type OrganizeProposalResult } from '@/lib/ai'
import { loadOrganizeGroups, OrganizeNeedsClientDataError } from '@/lib/ai-organize'
import { parseOrganizeBody, readJsonBody } from '@/lib/ai-validation'
import {
  aiError,
  aiErrorResponse,
  aiJson,
  authenticateAiRequest,
  invalidRequest,
  resolveAiContext,
} from '@/lib/ai-route'
import { tabOrganizerWorkflow } from '@/lib/workflows/tabOrganizer'

/**
 * Proposes a reorganization of the caller's tab groups and starts the approval workflow.
 *
 * The model call happens here, like every other AI route (metered in managed mode, on the
 * customer's key in BYOK mode, with structured output in the `analyzeGroupsInputSchema`
 * shape). The durable workflow then gets only the finished, sanitized proposal and the ids of
 * the client's permanent groups: it publishes the proposal to its stream, waits for the
 * approval hook and applies the approved actions. Workflow arguments are persisted in its
 * event log, so neither a BYOK key nor any tab data is ever passed to it.
 *
 * Group data: end-to-end encrypted users must send their locally decrypted groups in the
 * body, because `groups.windows` in Supabase is ciphertext the server can never read. Only a
 * request that sends no groups (no JSON object, or `groups` missing, null or empty) reads the
 * stored rows; sent groups are used or rejected with a 400, never replaced by the stored rows,
 * and stored rows that turn out to be encrypted end the request with a 400 before the model is
 * called.
 *
 * Returns `{ runId, token }`; the run id → user mapping is recorded so the GET handler can
 * check ownership before streaming.
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

  let proposal: OrganizeProposalResult
  let remaining: number | null
  try {
    ;({ result: proposal, remaining } = await runAiTask(organizeTask(groups), ctx))
  } catch (err) {
    return aiErrorResponse(err, 'organize')
  }

  try {
    const hookToken = `org-${auth.user.id}-${randomBytes(16).toString('hex')}`
    const pinnedIds = groups.filter((g) => g.permanent).map((g) => g.id)
    const run = await start(tabOrganizerWorkflow, [auth.user.id, hookToken, proposal, pinnedIds])

    // Store runId → userId so the GET stream can verify ownership.
    await auth.supabase.from('organize_runs').insert({ run_id: run.runId, user_id: auth.user.id })

    return aiJson({ runId: run.runId, token: hookToken }, remaining)
  } catch (err) {
    console.error('AI organize start error:', err instanceof Error ? err.name : typeof err)
    return aiError(500, AI_ERROR_CODES.failed, {}, remaining)
  }
}

/**
 * Streams the proposal of a workflow run identified by `runId` (one JSON array of actions,
 * then the stream ends). Checks that the run belongs to the caller before streaming (IDOR).
 */
export async function GET(request: NextRequest): Promise<Response> {
  // AI feature flag kill switch — must stay first, before any auth/DB/Anthropic work.
  const aiDisabled = aiDisabledResponse()
  if (aiDisabled) return aiDisabled

  const auth = await authenticateAiRequest(request)
  if (auth instanceof NextResponse) return auth

  const runId = new URL(request.url).searchParams.get('runId')
  if (!runId) return invalidRequest('runId required')

  const { data: runRecord } = await auth.supabase
    .from('organize_runs')
    .select('user_id')
    .eq('run_id', runId)
    .single()

  if (!runRecord || runRecord.user_id !== auth.user.id) {
    return aiError(404, AI_ERROR_CODES.notFound)
  }

  try {
    const readable = await getRun(runId).getReadable()
    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  } catch (err) {
    console.error('AI organize stream error:', err instanceof Error ? err.name : typeof err)
    return aiError(500, AI_ERROR_CODES.failed)
  }
}
