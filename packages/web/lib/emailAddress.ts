/**
 * Email address shape check shared by the public forms (contact, uninstall survey) and their API
 * routes. Safe in client components: no server imports.
 */

/** The longest a mailbox address can be. */
export const EMAIL_MAX = 254

// Domain labels exclude "." so each character can match in only one place:
// with "." allowed inside a label the pattern backtracks quadratically.
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** True for a string of a plausible address shape, at most {@link EMAIL_MAX} characters, with no whitespace. */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= EMAIL_MAX && EMAIL_RE.test(value)
}
