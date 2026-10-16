import { NextRequest, NextResponse } from 'next/server'
import {
  UNINSTALL_SURVEY_LIMITS,
  UNINSTALL_SURVEY_REASONS,
  isUninstallSurveyReasonId,
  parseUninstallSurveyParams,
  type UninstallSurveyReasonId,
} from '@tabmerger/shared'
import { isEmailAddress } from '@/lib/emailAddress'
import { stripControlChars } from '@/lib/plainText'
import { buildDiagnostics, createRateLimiter, getClientIp, sendSupportEmail, supportToAddress } from '@/lib/supportEmail'

/**
 * POST /api/uninstall-feedback
 *
 * Public, unauthenticated endpoint behind the `/uninstalled` page the browser
 * opens after the extension is removed. Emails the answer to the support inbox.
 *
 * Every field is rebuilt from the body one by one (unknown keys are ignored):
 * - `reasons`: array of known reason ids, at most one of each.
 * - `details`: optional free text, control characters removed, length-capped.
 * - `email`: optional reply address, same shape rule as the contact form.
 * - `version`/`browser`/`channel`: through `parseUninstallSurveyParams`; anything
 *   unrecognised is dropped, not rejected.
 * - `website`: a honeypot no person fills in. When filled, answer `{ ok: true }`
 *   and send nothing.
 * A request needs at least one reason or some text. The subject is fixed text,
 * the environment tag and validated reason ids only: nothing typed by the
 * sender reaches the subject or any header except a validated `replyTo`.
 */

/**
 * Largest body accepted. The text cap is in characters; JSON can spend up to 6
 * bytes on one (`\uXXXX`), plus the reply address and the reason ids.
 */
const BODY_MAX_BYTES = 16 * 1024

const isRateLimited = createRateLimiter(5, 60 * 60 * 1000) // 5 per hour per IP

const bad = () => NextResponse.json({ ok: false }, { status: 400 })

/** Validated survey answer, or null when the body breaks a rule. */
function parseAnswer(body: unknown): {
  reasons: UninstallSurveyReasonId[]
  details: string
  email?: string
  honeypot: boolean
  params: ReturnType<typeof parseUninstallSurveyParams>
} | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>

  const rawReasons = raw.reasons ?? []
  if (!Array.isArray(rawReasons) || rawReasons.length > UNINSTALL_SURVEY_LIMITS.reasons) return null
  if (!rawReasons.every(isUninstallSurveyReasonId)) return null
  // Keep the order of the shared list, one of each.
  const reasons = UNINSTALL_SURVEY_REASONS.map((r) => r.id).filter((id) => rawReasons.includes(id))

  const rawDetails = raw.details ?? ''
  if (typeof rawDetails !== 'string') return null
  const details = stripControlChars(rawDetails).trim()
  if (details.length > UNINSTALL_SURVEY_LIMITS.details) return null

  const rawEmail = raw.email ?? ''
  if (typeof rawEmail !== 'string') return null
  const trimmedEmail = rawEmail.trim()
  if (trimmedEmail.length > UNINSTALL_SURVEY_LIMITS.email) return null
  if (trimmedEmail && !isEmailAddress(trimmedEmail)) return null

  const honeypot = typeof raw.website === 'string' && raw.website.trim().length > 0

  return {
    reasons,
    details,
    email: trimmedEmail || undefined,
    honeypot,
    params: parseUninstallSurveyParams({ version: raw.version, browser: raw.browser, channel: raw.channel }),
  }
}

export async function POST(req: NextRequest) {
  if (isRateLimited(getClientIp(req))) {
    return NextResponse.json({ ok: false }, { status: 429 })
  }

  // Refuse an oversized body before reading it when the size is declared, and
  // again after reading in case it was not (or was wrong).
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return bad()
  }
  if (new TextEncoder().encode(text).length > BODY_MAX_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return bad()
  }

  const answer = parseAnswer(body)
  if (!answer) return bad()
  if (answer.honeypot) return NextResponse.json({ ok: true })
  if (answer.reasons.length === 0 && answer.details.length === 0) return bad()

  const { reasons, details, email, params } = answer
  const diagnostics = buildDiagnostics(req)
  const labels = reasons.map((id) => {
    const label = UNINSTALL_SURVEY_REASONS.find((r) => r.id === id)?.label
    return `- ${label} (${id})`
  })
  const textBody = [
    'Why they removed TabMerger:',
    ...(labels.length ? labels : ['- (no reason ticked)']),
    '',
    'Anything else:',
    details || '(nothing written)',
    '',
    `Reply to: ${email ?? 'none given'}`,
    '',
    `Extension version: ${params.version ?? 'unknown'}`,
    `Extension browser: ${params.browser ?? 'unknown'}`,
    `Release channel: ${params.channel ?? 'unknown'}`,
    '',
    '---',
    diagnostics.text,
  ].join('\n')

  const sent = await sendSupportEmail('uninstall-feedback', {
    to: supportToAddress('UNINSTALL_FEEDBACK_TO_EMAIL', 'CONTACT_TO_EMAIL'),
    replyTo: email,
    subject: `[Uninstall]${diagnostics.envTag} ${reasons.length ? reasons.join(', ') : 'comment only'}`,
    text: textBody,
  })
  if (!sent) return NextResponse.json({ ok: false }, { status: 500 })

  return NextResponse.json({ ok: true })
}
