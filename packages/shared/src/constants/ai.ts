/**
 * Pro AI economics, models and error codes, shared by the web app's `/api/ai/*` routes, the
 * pricing and dashboard pages, and the extension. The server enforces everything here; the
 * clients only use it to explain limits and estimate costs.
 *
 * Money is computed in integers (cents, basis points, micro-dollars) so a price like $2.50 never
 * rounds to one credit less than it should.
 */

// --- Plan options -------------------------------------------------------------

/**
 * How a Pro AI subscription pays for AI: `managed` uses TabMerger's Anthropic key within a
 * monthly credit allowance; `byok` forwards the customer's own Anthropic key with each request.
 * Stored in `subscriptions.ai_mode`.
 */
export const AI_MODES = ['managed', 'byok'] as const;

export type AiMode = (typeof AI_MODES)[number];

/** Whether a value read from the server or a request body is an {@link AiMode}. */
export function isAiMode(value: unknown): value is AiMode {
  return typeof value === 'string' && (AI_MODES as readonly string[]).includes(value);
}

// --- Credit economics ---------------------------------------------------------

/** One credit is $0.001 of Anthropic list-price cost. */
export const CREDIT_MICRO_USD = 1000;

/** The most of a subscriber's net payment that managed AI usage may cost (40%). */
export const AI_COST_SHARE_PERCENT = 40;

/**
 * Payment fees assumed when working out what a payment nets, deliberately on the high side:
 * card 2.9% + international 1.5% + Stripe Billing 0.7%, rounded up to 6%, plus $0.30.
 */
export const PAYMENT_FEE_BPS = 600;
export const PAYMENT_FEE_FIXED_CENTS = 30;

/**
 * Credits a payment can fund while keeping AI cost within {@link AI_COST_SHARE_PERCENT} of the
 * payment after fees, spread over `months` (12 for a yearly plan). Never negative.
 *
 * Examples: a $2.50 credit pack funds 820 credits; an $85.99 yearly plan funds 2,684 a month.
 */
export function creditsForPayment(usd: number, months = 1): number {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isInteger(months) || months < 1) return 0;
  // Whole cents, rounded down (a 50%-off $7.99 is $3.995, worth 399 cents here, never 400). The
  // inner rounding to 1/100 cent first absorbs float noise such as 7.99 * 100 = 798.999….
  const cents = Math.floor(Math.round(usd * 10_000) / 100);
  // Net revenue in units of 1/10,000 cent, so the fee rate stays an integer.
  const netTenThousandthsOfCent = cents * (10_000 - PAYMENT_FEE_BPS) - PAYMENT_FEE_FIXED_CENTS * 10_000;
  if (netTenThousandthsOfCent <= 0) return 0;
  // 1/10,000 cent is 1 micro-dollar, so dividing by CREDIT_MICRO_USD gives credits.
  return Math.floor((netTenThousandthsOfCent * AI_COST_SHARE_PERCENT) / (100 * CREDIT_MICRO_USD * months));
}

/**
 * The advertised monthly allowance of managed Pro AI at full price: the yearly plan's figure
 * (the lower of the two intervals) rounded down to a clean number. A subscription's actual
 * allowance is the smaller of this and {@link creditsForPayment} of what it really pays, so a
 * discount lowers it (see `subscriptions.ai_monthly_credits`).
 */
export const PRO_AI_MONTHLY_CREDITS = 2600;

/** Monthly managed allowance for a subscription paying `usd` every `months` months. */
export function monthlyAllowanceForPayment(usd: number, months: number): number {
  return Math.min(PRO_AI_MONTHLY_CREDITS, creditsForPayment(usd, months));
}

// --- Models -------------------------------------------------------------------

export const AI_MODEL_IDS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;

export type AiModelId = (typeof AI_MODEL_IDS)[number];

/** Anthropic list prices, in US cents per million tokens. */
interface TokenPrices {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
}

export interface AiModelInfo extends TokenPrices {
  id: AiModelId;
  /** Product name; not translated. */
  label: string;
  /** Prices for the whole request once its input exceeds `thresholdTokens`. */
  longContext?: TokenPrices & { thresholdTokens: number };
  /**
   * Typical extra output tokens the model spends thinking on these short tasks. Only for
   * estimates; billing always uses the real usage.
   */
  typicalThinkingTokens: number;
}

export const AI_MODELS: Record<AiModelId, AiModelInfo> = {
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    inputCentsPerMTok: 10,
    outputCentsPerMTok: 50,
    longContext: { thresholdTokens: 100_000, inputCentsPerMTok: 50, outputCentsPerMTok: 250 },
    typicalThinkingTokens: 0,
  },
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    inputCentsPerMTok: 200,
    outputCentsPerMTok: 1000,
    typicalThinkingTokens: 0,
  },
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    inputCentsPerMTok: 400,
    outputCentsPerMTok: 2000,
    // Thinking can't be turned off on Opus 5.5; effort `low` keeps it short.
    typicalThinkingTokens: 300,
  },
};

export function isAiModelId(value: unknown): value is AiModelId {
  return typeof value === 'string' && (AI_MODEL_IDS as readonly string[]).includes(value);
}

/** What the user picks in Settings: a fixed model, or `auto` to let each feature use its default. */
export type AiModelChoice = 'auto' | AiModelId;

export const AI_MODEL_CHOICES: readonly AiModelChoice[] = ['auto', ...AI_MODEL_IDS];

export const DEFAULT_AI_MODEL_CHOICE: AiModelChoice = 'auto';

export const AI_ACTIONS = ['nameGroup', 'tabSummary', 'groupTabs', 'suggestSessions', 'organize'] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

/** The model `auto` uses for each feature: the cheapest one that does the job well. */
export const AUTO_AI_MODEL: Record<AiAction, AiModelId> = {
  nameGroup: 'claude-haiku-5-5',
  tabSummary: 'claude-haiku-5-5',
  groupTabs: 'claude-haiku-5-5',
  suggestSessions: 'claude-haiku-5-5',
  organize: 'claude-sonnet-5-5',
};

/**
 * The model a request runs on. A missing choice (or `auto`) uses the feature's default; any
 * other value that isn't a known model returns `null`, which the server answers with
 * `ai_model_invalid`.
 */
export function resolveAiModel(choice: unknown, action: AiAction): AiModelId | null {
  if (choice === undefined || choice === null || choice === 'auto') return AUTO_AI_MODEL[action];
  return isAiModelId(choice) ? choice : null;
}

// --- Cost of a call -----------------------------------------------------------

/** 1 cent per million tokens, per token, is 1e-8 dollars; a credit ($0.001) is 100,000 of those. */
const PRICE_UNITS_PER_CREDIT = 100_000;

function pricesFor(model: AiModelId, inputTokens: number): TokenPrices {
  const info = AI_MODELS[model];
  return info.longContext && inputTokens > info.longContext.thresholdTokens ? info.longContext : info;
}

function priceUnits(model: AiModelId, inputTokens: number, outputTokens: number): number {
  const prices = pricesFor(model, inputTokens);
  return inputTokens * prices.inputCentsPerMTok + outputTokens * prices.outputCentsPerMTok;
}

/**
 * Credits a call costs: its list-price cost rounded up to whole credits, at least 1 when it used
 * any tokens and 0 when it used none. `outputTokens` includes thinking tokens. Used both for the
 * worst-case reservation (`max_tokens` as output) and for settling to the real usage.
 */
export function aiCallCredits(model: AiModelId, inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, Math.ceil(inputTokens));
  const output = Math.max(0, Math.ceil(outputTokens));
  if (input + output === 0) return 0;
  return Math.max(1, Math.ceil(priceUnits(model, input, output) / PRICE_UNITS_PER_CREDIT));
}

/** The same cost in US dollars, for showing a BYOK user what Anthropic will bill them. */
export function aiCallCostUsd(model: AiModelId, inputTokens: number, outputTokens: number): number {
  return priceUnits(model, Math.max(0, inputTokens), Math.max(0, outputTokens)) / 1e8;
}

// --- Estimates for the Settings model picker ------------------------------------

/** Rough token counts for estimates only: a tab's title and URL, and each prompt's fixed text. */
const ESTIMATE_TOKENS_PER_TAB = 60;
const ESTIMATE_PROMPT_OVERHEAD_TOKENS = 300;

function estimatedOutputTokens(action: AiAction, tabs: number): number {
  switch (action) {
    case 'nameGroup':
      return 15;
    case 'tabSummary':
      return 40;
    case 'groupTabs':
      return 100 + 5 * tabs;
    case 'suggestSessions':
      return 100;
    case 'organize':
      return 300 + 4 * tabs;
  }
}

function estimatedTokens(model: AiModelId, action: AiAction, tabs: number) {
  const count = action === 'tabSummary' ? 1 : Math.max(1, Math.round(tabs));
  return {
    input: ESTIMATE_PROMPT_OVERHEAD_TOKENS + ESTIMATE_TOKENS_PER_TAB * count,
    output: estimatedOutputTokens(action, count) + AI_MODELS[model].typicalThinkingTokens,
  };
}

/** Approximate credits for one action over `tabs` tabs. Shown as "≈"; never used for billing. */
export function estimateAiCredits(model: AiModelId, action: AiAction, tabs: number): number {
  const { input, output } = estimatedTokens(model, action, tabs);
  return aiCallCredits(model, input, output);
}

/** Approximate Anthropic cost in US dollars of one action, for BYOK users. */
export function estimateAiCostUsd(model: AiModelId, action: AiAction, tabs: number): number {
  const { input, output } = estimatedTokens(model, action, tabs);
  return aiCallCostUsd(model, input, output);
}

/**
 * The examples the Settings model picker shows for each model, so the "burn rate" reads as
 * concrete actions rather than a multiplier.
 */
export const AI_ESTIMATE_EXAMPLES: readonly { action: AiAction; tabs: number }[] = [
  { action: 'nameGroup', tabs: 10 },
  { action: 'groupTabs', tabs: 100 },
  { action: 'organize', tabs: 300 },
];

// --- Bring your own key ---------------------------------------------------------

/** Request header that carries a BYOK user's Anthropic key to `/api/ai/*`. Never stored server-side. */
export const AI_BYOK_KEY_HEADER = 'X-Anthropic-Key';

/** The shape of an Anthropic API key. Checked before a key is saved and before it is forwarded. */
export const ANTHROPIC_API_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

export function isAnthropicApiKey(value: unknown): value is string {
  return typeof value === 'string' && ANTHROPIC_API_KEY_PATTERN.test(value);
}

/** A key as shown after it's saved: `sk-ant-…abcd`. */
export function maskApiKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`;
}

// --- Errors -----------------------------------------------------------------------

/**
 * The `error` field of every failed `/api/ai/*` response (and the credit-pack checkout), so the
 * extension and web app can say what to do. BYOK errors never use 401 (that means TabMerger's
 * own sign-in failed) or 429 (that means TabMerger credits ran out).
 */
export const AI_ERROR_CODES = {
  disabled: 'ai_disabled',
  planRequired: 'ai_plan_required',
  quotaExceeded: 'ai_quota_exceeded',
  modelInvalid: 'ai_model_invalid',
  overloaded: 'ai_overloaded',
  byokKeyMissing: 'byok_key_missing',
  byokKeyInvalid: 'byok_key_invalid',
  byokRateLimited: 'byok_rate_limited',
  byokBilling: 'byok_billing',
  creditsNotApplicable: 'credits_not_applicable',
  /** The TabMerger sign-in token is missing or invalid (401). */
  unauthorized: 'ai_unauthorized',
  /** The request body is malformed or over a limit (400); `message` says what. */
  invalidRequest: 'ai_invalid_request',
  /** The model declined the request (`stop_reason: refusal`); its usage is still charged. */
  refused: 'ai_refused',
  /** Anything else went wrong (unreadable model output, a server or database error). */
  failed: 'ai_failed',
  /** The requested organize run does not exist or belongs to someone else (404). */
  notFound: 'ai_not_found',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/** Response header carrying the managed credits left this month after a successful call. */
export const AI_CREDITS_REMAINING_HEADER = 'X-AI-Credits-Remaining';
