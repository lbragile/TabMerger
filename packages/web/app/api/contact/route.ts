import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

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
 */

// Resend's shared test sender (onboarding@resend.dev) only delivers to the
// Resend account owner's own address; anything else is refused with a
// "testing domain restriction" error. To reach a real support inbox, verify a
// domain in Resend and set CONTACT_FROM_EMAIL to an address on it (e.g.
// "TabMerger Support <support@your-domain>"). CONTACT_TO_EMAIL picks the inbox.
const DEFAULT_FROM = 'TabMerger Support <onboarding@resend.dev>'
const DEFAULT_TO = 'tabmerger.support@gmail.com'

const SUBJECT_MAX = 200
const MESSAGE_MAX = 5000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1h

// ponytail: module-level Map, same lazy per-IP rate-limit pattern as
// og-preview's cache — no Redis/infra, add if this ever needs to survive
// serverless cold starts / multiple instances.
const submissions = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (submissions.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    submissions.set(ip, recent)
    return true
  }
  recent.push(now)
  submissions.set(ip, recent)
  return false
}

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const ip = getIp(req)
  if (isRateLimited(ip)) {
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
    typeof email !== 'string' ||
    !EMAIL_RE.test(email) ||
    email.length > 254 ||
    typeof subject !== 'string' ||
    subject.trim().length === 0 ||
    subject.length > SUBJECT_MAX ||
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > MESSAGE_MAX
  ) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: process.env.CONTACT_FROM_EMAIL || DEFAULT_FROM,
      to: process.env.CONTACT_TO_EMAIL || DEFAULT_TO,
      replyTo: email,
      subject: `[Contact] ${subject}`,
      text: `From: ${email}\n\n${message}`,
    })
    if (error) {
      // Log only the error shape (name/statusCode), never `error.message` —
      // Resend error messages can embed the recipient/sender address — and
      // never the submitter's email, subject, or message body. This is the
      // only signal Vercel logs get for a Resend refusal, so without it a
      // failure is completely silent.
      console.error('[contact] send failed', { name: error.name, statusCode: error.statusCode })
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  } catch (err) {
    // Non-Resend failures (network, thrown exceptions) — same PII-free shape.
    console.error('[contact] send failed', {
      name: err instanceof Error ? err.name : 'UnknownError',
      statusCode: undefined,
    })
    // Never leak Resend internals to the client.
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
