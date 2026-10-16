import type { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { isEmailAddress } from '@/lib/emailAddress'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

/**
 * Server-only pieces shared by the public routes that email the support inbox
 * (`/api/contact`, `/api/uninstall-feedback`): per-IP rate limiting, the
 * non-personal diagnostics block, and the Resend send with PII-free logging.
 */

// Defaults when CONTACT_FROM_EMAIL / CONTACT_TO_EMAIL are unset or invalid.
// tabmerger.com is a verified sending domain in Resend, so the sender must stay
// on that domain (Resend refuses an unverified one). SUPPORT_EMAIL is also the
// public support inbox: mail sent to it is forwarded to the maintainer.
export const DEFAULT_FROM = `TabMerger Support <${SUPPORT_EMAIL}>`
export const DEFAULT_TO = SUPPORT_EMAIL

// "Display Name <address>": a name of printable characters other than the ones
// that would end or restructure the header (`"`, `<`, `>`), then a bracketed address.
const NAMED_ADDRESS_RE = /^([^"<>\p{Cc}]{1,64}) <([^<>]+)>$/u

/** True for `address` or `Display Name <address>`, with a valid address and no control characters. */
export function isSenderAddress(value: string): boolean {
  const named = NAMED_ADDRESS_RE.exec(value)
  return named ? named[1].trim().length > 0 && isEmailAddress(named[2]) : isEmailAddress(value)
}

/**
 * The first set and valid value among the named env vars, else `fallback`. A set
 * but invalid value is skipped with a warning that names the variable only (the
 * value may be a personal address), so a typo in Vercel can't put arbitrary text
 * into an email header and still delivers to the public support inbox.
 */
function addressFromEnv(names: string[], isValid: (value: string) => boolean, fallback: string): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (!value) continue
    if (isValid(value)) return value
    console.warn(`[supportEmail] ignoring invalid ${name}`)
  }
  return fallback
}

/** Sender address for every support email: `CONTACT_FROM_EMAIL` when valid, else {@link DEFAULT_FROM}. */
export function supportFromAddress(): string {
  return addressFromEnv(['CONTACT_FROM_EMAIL'], isSenderAddress, DEFAULT_FROM)
}

/**
 * Inbox for a support email: the first valid address among `envNames` (in order),
 * else {@link DEFAULT_TO}. Each value must be one plain address, not a list.
 */
export function supportToAddress(...envNames: string[]): string {
  return addressFromEnv(envNames, isEmailAddress, DEFAULT_TO)
}

/**
 * A per-IP limiter: at most `max` calls of `isLimited(ip)` answer false within
 * `windowMs`. Each route makes its own, so one form's traffic never uses up
 * another's allowance.
 *
 * ponytail: module-level Map, same lazy per-IP rate-limit pattern as
 * og-preview's cache — no Redis/infra, add if this ever needs to survive
 * serverless cold starts / multiple instances.
 */
export function createRateLimiter(max: number, windowMs: number): (ip: string) => boolean {
  const hits = new Map<string, number[]>()
  return (ip: string) => {
    const now = Date.now()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      hits.set(ip, recent)
      return true
    }
    recent.push(now)
    hits.set(ip, recent)
    return false
  }
}

/** First address in `x-forwarded-for`, used only as a rate-limit key (never logged or emailed). */
export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

/**
 * Coarse browser and OS from a User-Agent, e.g. "Chrome 140 on Windows". The
 * raw User-Agent string is a fingerprinting signal, so it never leaves here.
 */
export function describeBrowser(userAgent: string | null): string {
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
 * Non-personal diagnostics appended to every support email, so a report can
 * be matched to the build and page it came from. Nothing here identifies the
 * sender: no IP, no raw User-Agent, no query string beyond the contact form's
 * own `topic`, and no location. `envTag` is the subject prefix: empty on
 * production, `[preview]` etc. elsewhere.
 */
export function buildDiagnostics(req: NextRequest): { env: string; envTag: string; text: string } {
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
  return { env, envTag: env === 'production' ? '' : `[${env}]`, text: lines.join('\n') }
}

/**
 * Sends one support email through Resend. Answers whether it was accepted.
 *
 * Logs only the error shape (name/statusCode) under `[<logTag>] send failed`,
 * never `error.message` (Resend messages can embed the recipient/sender
 * address) and never anything the submitter typed. This is the only signal
 * Vercel logs get for a Resend refusal, so without it a failure is silent.
 * Callers answer the client with a generic failure; nothing from Resend is echoed.
 */
export async function sendSupportEmail(
  logTag: string,
  message: { to: string; subject: string; text: string; replyTo?: string }
): Promise<boolean> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: supportFromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    })
    if (error) {
      console.error(`[${logTag}] send failed`, { name: error.name, statusCode: error.statusCode })
      return false
    }
    return true
  } catch (err) {
    // Non-Resend failures (network, thrown exceptions) — same PII-free shape.
    console.error(`[${logTag}] send failed`, {
      name: err instanceof Error ? err.name : 'UnknownError',
      statusCode: undefined,
    })
    return false
  }
}
