/**
 * Cookie consent for the website's analytics (Google Analytics and PostHog).
 *
 * The visitor's choice lives in one first-party cookie, `tm_consent`, set only when they press
 * Accept or Reject in the banner (it is strictly necessary: it records the choice itself). Until
 * then the stored choice is `null`. The cookie is untrusted input like any other: anything but the
 * two exact values reads as "no choice".
 *
 * What happens without a stored choice depends on the visitor (see `getEffectiveConsent`): in an
 * opt-in region (EEA, UK, Switzerland, Quebec, or unknown) nothing loads until they accept; in an
 * opt-out region analytics run until they reject; a browser sending Global Privacy Control counts
 * as a Reject everywhere until the visitor accepts explicitly.
 *
 * This module is the single source of truth for the choice and for whether the banner is open;
 * the banner, the footer's "Cookie settings" button and the analytics loaders subscribe to it.
 */

import { CONSENT_REGION_COOKIE, parseConsentRegion, type ConsentRegion } from '@/lib/consentRegions'

export const CONSENT_COOKIE = 'tm_consent'

/** A year: long enough not to ask again on every visit, short enough to ask again eventually. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export const CONSENT_CHOICES = ['granted', 'denied'] as const
export type ConsentChoice = (typeof CONSENT_CHOICES)[number]

/** The choice a raw cookie value stands for, or `null` for anything that isn't exactly one. */
export function parseConsent(value: unknown): ConsentChoice | null {
  return value === 'granted' || value === 'denied' ? value : null
}

/**
 * The stored choice in a `document.cookie`-style string. The first `tm_consent` wins (the
 * browser lists the most specific path first); a value that isn't valid percent-encoding or isn't
 * one of the two choices is no choice.
 */
export function readConsentCookie(cookieHeader: string): ConsentChoice | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== CONSENT_COOKIE) continue
    let value: string
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return null
    }
    return parseConsent(value)
  }
  return null
}

/** The `Set-Cookie`-style string that stores `choice` (Secure on https only, so http dev works). */
export function consentCookieString(choice: ConsentChoice, secure: boolean): string {
  return `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
}

// The choice made in this page's lifetime, so pressing a button hides the banner even when the
// browser refuses the cookie. The cookie still wins whenever it holds a valid choice.
let sessionChoice: ConsentChoice | null = null
let settingsOpen = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the choice or the banner's open state changes; returns the unsubscribe. */
export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The visitor's current choice, or `null` if they haven't made one (always `null` on the server). */
export function getConsentChoice(): ConsentChoice | null {
  if (typeof document === 'undefined') return null
  return readConsentCookie(document.cookie) ?? sessionChoice
}

/** The value of the first cookie called `name` in a `document.cookie`-style string, or `null`. */
function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * The visitor's consent region, from the `tm_consent_region` cookie the proxy sets. Missing or
 * anything but the two exact values is opt-in, the safe side.
 */
export function getConsentRegion(): ConsentRegion {
  if (typeof document === 'undefined') return 'optin'
  return parseConsentRegion(readCookie(document.cookie, CONSENT_REGION_COOKIE)) ?? 'optin'
}

/**
 * Whether the browser sends Global Privacy Control (`navigator.globalPrivacyControl`, exactly `true`).
 *
 * Read in the browser only, and that is enough: the GPC spec has every browser that sends the
 * `Sec-GPC: 1` header expose this property too, and nothing on the website tracks before the
 * browser has checked it (gtag.js and PostHog load from effects that ask `getEffectiveConsent`
 * first). Honouring the header in the proxy or the layout instead would make the static pages
 * render per request for no gain.
 */
export function hasGlobalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator as Navigator & { globalPrivacyControl?: unknown }).globalPrivacyControl === true
}

/**
 * The choice analytics follow: the stored one if there is one; otherwise Reject for a browser
 * sending Global Privacy Control, Accept in an opt-out region, and `null` (ask first, load
 * nothing) in an opt-in region.
 */
export function getEffectiveConsent(): ConsentChoice | null {
  const stored = getConsentChoice()
  if (stored) return stored
  if (hasGlobalPrivacyControl()) return 'denied'
  return getConsentRegion() === 'optout' ? 'granted' : null
}

/**
 * What the banner says when it opens: `ask` (the visitor hasn't chosen, or has and reopened it),
 * `on` (analytics are on by default in their region) or `gpc` (off because of Global Privacy Control).
 */
export type ConsentNotice = 'ask' | 'on' | 'gpc'

export function getConsentNotice(): ConsentNotice {
  if (getConsentChoice()) return 'ask'
  if (hasGlobalPrivacyControl()) return 'gpc'
  return getConsentRegion() === 'optout' ? 'on' : 'ask'
}

/** Whether the visitor reopened the banner from "Cookie settings". */
export function isCookieSettingsOpen(): boolean {
  return settingsOpen
}

/** Stores the visitor's choice (cookie + this page), closes the banner and tells every subscriber. */
export function setConsentChoice(choice: ConsentChoice): void {
  const valid = parseConsent(choice)
  if (!valid) return
  sessionChoice = valid
  document.cookie = consentCookieString(valid, globalThis.location?.protocol === 'https:')
  settingsOpen = false
  notify()
}

/** Reopens the banner so the visitor can change their choice (the footer's "Cookie settings"). */
export function openCookieSettings(): void {
  if (settingsOpen) return
  settingsOpen = true
  notify()
}

/**
 * Closes a banner opened from "Cookie settings" without a new choice (the phone layout's
 * collapse button and Escape). The stored choice, if any, stays as it was.
 */
export function closeCookieSettings(): void {
  if (!settingsOpen) return
  settingsOpen = false
  notify()
}

/** Test-only: forgets this page's in-memory choice and closes the banner. */
export function resetConsentStateForTests(): void {
  sessionChoice = null
  settingsOpen = false
  notify()
}

/**
 * Deletes the cookies whose names match `pattern`, on this host and on each parent domain (tools
 * like Google Analytics set theirs on the widest domain they can). A domain the browser won't
 * accept, such as a public suffix, is simply ignored.
 */
export function deleteCookies(pattern: RegExp): void {
  if (typeof document === 'undefined') return
  const host = globalThis.location?.hostname ?? ''
  const labels = host.split('.')
  const domains = ['', ...labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'))]
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (!name || !pattern.test(name)) continue
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`
    }
  }
}
