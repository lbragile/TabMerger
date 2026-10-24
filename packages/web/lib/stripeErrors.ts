/**
 * One log line for a failed Stripe call: the error's type, code, parameter, HTTP status, request id
 * and message. Never the error object itself (its raw response and headers) or anything about the
 * customer beyond what Stripe's message names (price, product or subscription ids).
 */
export function describeStripeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    type?: unknown
    code?: unknown
    param?: unknown
    statusCode?: unknown
    requestId?: unknown
    message?: unknown
  }
  const parts = [
    typeof e.type === 'string' ? e.type : 'Error',
    typeof e.code === 'string' ? `code ${e.code}` : null,
    typeof e.param === 'string' ? `param ${e.param}` : null,
    typeof e.statusCode === 'number' ? `status ${e.statusCode}` : null,
    typeof e.requestId === 'string' ? `request ${e.requestId}` : null,
  ].filter(Boolean)
  const message = typeof e.message === 'string' ? e.message.slice(0, 300) : ''
  return `${parts.join(', ')}${message ? `: ${message}` : ''}`
}
