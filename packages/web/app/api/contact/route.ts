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
// Domain labels exclude "." so each character can match in only one place:
// with "." allowed inside a label the pattern backtracks quadratically.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

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

/**
 * Coarse browser and OS from a User-Agent, e.g. "Chrome 140 on Windows". The
 * raw User-Agent string is a fingerprinting signal, so it never leaves here.
 */
function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return 'unknown'
  const browsers: [string, RegExp][] = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ]
  const oses: [string, RegExp][] = [
    ['Windows', /Windows/],
    ['ChromeOS', /CrOS/],
    ['Android', /Android/],
    ['iOS', /iPhone|iPad/],
    ['macOS', /Mac OS X/],
    ['Linux', /Linux/],
  ]
  const browser = browsers.find(([, re]) => re.test(userAgent))
  const os = oses.find(([, re]) => re.test(userAgent))?.[0] ?? 'unknown OS'
  const version = browser ? userAgent.match(browser[1])?.[1] : undefined
  return `${browser ? `${browser[0]} ${version}` : 'unknown browser'} on ${os}`
}

/**
 * Non-personal diagnostics appended to every contact email, so a report can
 * be matched to the build and page it came from. Nothing here identifies the
 * sender: no IP, no raw User-Agent, no query string beyond the form's own
 * `topic`, and no location.
 */
function buildDiagnostics(req: NextRequest): { env: string; text: string } {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  const branch = process.env.VERCEL_GIT_COMMIT_REF
  const deployment = process.env.VERCEL_DEPLOYMENT_ID
  const site = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  let page = 'unknown'
  let topic: string | null = null
  try {
    const referer = req.headers.get('referer')
    if (referer) {
      const url = new URL(referer)
      page = url.pathname
      topic = url.searchParams.get('topic')
    }
  } catch {
    // Malformed Referer: leave the page as unknown.
  }
  const language = req.headers.get('accept-language')?.split(',')[0]?.split(';')[0]?.trim() || 'unknown'
  const lines = [
    `Environment: ${env}`,
    `Site: ${site}`,
    `Commit: ${sha ? sha.slice(0, 7) : 'unknown'}${branch ? ` (${branch})` : ''}`,
    ...(deployment ? [`Deployment: ${deployment}`] : []),
    `Sent from page: ${page}${topic ? ` (topic: ${topic.slice(0, 32)})` : ''}`,
    `Browser: ${describeBrowser(req.headers.get('user-agent'))}`,
    `Language: ${language.slice(0, 16)}`,
    `Received: ${new Date().toISOString()}`,
  ]
  return { env, text: lines.join('\n') }
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
    email.length > 254 ||
    !EMAIL_RE.test(email) ||
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
    const diagnostics = buildDiagnostics(req)
    const envTag = diagnostics.env === 'production' ? '' : `[${diagnostics.env}]`
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: process.env.CONTACT_FROM_EMAIL || DEFAULT_FROM,
      to: process.env.CONTACT_TO_EMAIL || DEFAULT_TO,
      replyTo: email,
      subject: `[Contact]${envTag} ${subject}`,
      text: `From: ${email}\n\n${message}\n\n---\n${diagnostics.text}`,
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
