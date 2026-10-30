import { AI_ERROR_CODES } from '@tabmerger/shared';
import { activeLocale, t, type MessageKey } from '@/lib/i18n';

/**
 * Errors of the `/api/ai/*` requests, kept out of hooks/useAI.ts so components can recognise them
 * without importing the hooks (many component tests mock that module wholesale).
 */

/** Thrown on a 429 `ai_quota_exceeded` (out of TabMerger credits), or by the client-side estimate check before one. */
export class QuotaExceededError extends Error {
  isQuotaExceeded = true as const;
  /** Credits the request needed and had left, when known (the server sends both with the 429). */
  needed?: number;
  remaining?: number;
}

/**
 * A failed AI request with the server's error code (`AI_ERROR_CODES`), or null when it sent none.
 * `retryAfterSeconds` is set for `rate_limited`, when the server said how long to wait.
 */
export class AiRequestError extends Error {
  constructor(
    readonly code: string | null,
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/**
 * The message for each error code, by the code's name in `AI_ERROR_CODES`. A complete record, so
 * a code added to the shared constant fails `tsc` here until it has a message. A code the server
 * sends that this build doesn't know (a newer server) gets {@link AI_ERROR_FALLBACK_KEY}.
 */
const MESSAGE_KEYS: Record<keyof typeof AI_ERROR_CODES, MessageKey> = {
  disabled: 'errors.ai.disabled',
  planRequired: 'errors.proAiRequired',
  quotaExceeded: 'common.aiQuotaUsed',
  modelInvalid: 'errors.ai.modelInvalid',
  overloaded: 'errors.ai.overloaded',
  byokKeyMissing: 'errors.ai.byokKeyMissing',
  byokKeyInvalid: 'errors.ai.byokKeyInvalid',
  byokRateLimited: 'errors.ai.byokRateLimited',
  byokBilling: 'errors.ai.byokBilling',
  creditsNotApplicable: 'errors.ai.creditsNotApplicable',
  unauthorized: 'errors.ai.unauthorized',
  invalidRequest: 'errors.ai.invalidRequest',
  refused: 'errors.ai.refused',
  failed: 'errors.ai.failed',
  notFound: 'errors.ai.failed',
  rateLimited: 'errors.ai.rateLimited'
};

/** The generic message for a code this build doesn't know. */
export const AI_ERROR_FALLBACK_KEY: MessageKey = 'errors.ai.failed';

const CODE_TO_KEY = new Map<string, MessageKey>(
  Object.entries(AI_ERROR_CODES).flatMap(([name, code]) => {
    const key = MESSAGE_KEYS[name as keyof typeof AI_ERROR_CODES];
    return key ? [[code as string, key] as const] : [];
  })
);

/**
 * A wait of `seconds` the way the active locale says it ("in 30 seconds", "in 2 minutes"), in
 * whole seconds under a minute, else whole minutes under an hour, else whole hours, rounded up.
 */
export function formatRetryAfter(seconds: number): string {
  const format = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'always' });
  if (seconds < 60) return format.format(Math.ceil(seconds), 'second');
  if (seconds < 3600) return format.format(Math.ceil(seconds / 60), 'minute');
  return format.format(Math.ceil(seconds / 3600), 'hour');
}

/** A usable server wait: a finite number of seconds of at least 1 (rounded up), else undefined. */
export function retryAfterSecondsOf(value: unknown): number | undefined {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.ceil(seconds)) : undefined;
}

/**
 * The translated message for a server error code. A `rate_limited` reply that said how long to
 * wait (`retryAfterSeconds`) names the wait; without one it says to try again in a minute.
 */
export function aiErrorMessage(code: string, details: { retryAfterSeconds?: number } = {}): string {
  if (code === AI_ERROR_CODES.rateLimited && details.retryAfterSeconds !== undefined) {
    return t('errors.ai.rateLimitedRetry', { when: formatRetryAfter(details.retryAfterSeconds) });
  }
  return t(CODE_TO_KEY.get(code) ?? AI_ERROR_FALLBACK_KEY);
}

/** Codes whose fix is in Settings → AI: add or replace the key, check Anthropic billing (linked there), pick another model. */
const SETTINGS_CODES: ReadonlySet<string> = new Set([
  AI_ERROR_CODES.byokKeyMissing,
  AI_ERROR_CODES.byokKeyInvalid,
  AI_ERROR_CODES.byokBilling,
  AI_ERROR_CODES.modelInvalid
]);

/** Whether the fix for `err` is in Settings → AI, so callers can offer an "Open Settings" action. */
export function isFixedInAiSettings(err: unknown): boolean {
  return err instanceof AiRequestError && err.code !== null && SETTINGS_CODES.has(err.code);
}
