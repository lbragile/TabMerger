import { NextRequest, NextResponse } from 'next/server'
import { isEmailAddress } from '@/lib/emailAddress'
import { buildDiagnostics, createRateLimiter, getClientIp, sendSupportEmail, supportToAddress } from '@/lib/supportEmail'

/**
 * POST /api/contact
 *
 * Public, unauthenticated endpoint backing the marketing site's Contact
 * form. Sends the submission to the support inbox via Resend with
 * `replyTo` set to the submitter's address, so replying from Gmail goes
 * straight back to them.
 *
 * Unauthenticated + email-sending = a real spam/abuse surface, so inputs
 * are validated (email shape, length caps on subject/message) and a
 * lightweight per-IP rate limit is applied before ever calling Resend.
 * Resend errors are never echoed to the client — generic success/failure only.
 * The shared pieces (rate limiter, diagnostics, send + logging) live in
 * `lib/supportEmail.ts`.
 */

const SUBJECT_MAX = 200
const MESSAGE_MAX = 5000

const isRateLimited = createRateLimiter(5, 60 * 60 * 1000) // 5 per hour per IP

export async function POST(req: NextRequest) {
  if (isRateLimited(getClientIp(req))) {
    return NextResponse.json({ ok: false }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const { email, subject, message } = (body ?? {}) as Record<string, unknown>

  if (
    !isEmailAddress(email) ||
    typeof subject !== 'string' ||
    subject.trim().length === 0 ||
    subject.length > SUBJECT_MAX ||
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > MESSAGE_MAX
  ) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const diagnostics = buildDiagnostics(req)
  const sent = await sendSupportEmail('contact', {
    to: supportToAddress('CONTACT_TO_EMAIL'),
    replyTo: email,
    subject: `[Contact]${diagnostics.envTag} ${subject}`,
    text: `From: ${email}\n\n${message}\n\n---\n${diagnostics.text}`,
  })
  if (!sent) return NextResponse.json({ ok: false }, { status: 500 })

  return NextResponse.json({ ok: true })
}
