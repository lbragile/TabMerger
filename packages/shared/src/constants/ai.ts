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
 * monthly credit allowance; `byok` forwards the customer's own Anthropic, OpenAI or Google key
 * with each request.
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
 * (the lower of the two intervals) rounded down to a round 500. A subscription's actual
 * allowance is the smaller of this and {@link creditsForPayment} of what it really pays, so a
 * discount lowers it (see `subscriptions.ai_monthly_credits`).
 */
export const PRO_AI_MONTHLY_CREDITS = 2500;

/** Monthly managed allowance for a subscription paying `usd` every `months` months. */
export function monthlyAllowanceForPayment(usd: number, months: number): number {
  return Math.min(PRO_AI_MONTHLY_CREDITS, creditsForPayment(usd, months));
}

// --- Providers and models ---------------------------------------------------------

/**
 * AI companies a Pro AI request can go to. Managed Pro AI only ever uses `anthropic` (TabMerger's
 * key); an own-key subscriber uses whichever company issued their key.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'google'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The provider managed Pro AI runs on. */
export const MANAGED_AI_PROVIDER: AiProvider = 'anthropic';

/**
 * The provider names users know, shown wherever an own-key provider is named; not translated.
 * Gemini is Google's AI product (its keys are Gemini API keys); the id stays `google`.
 */
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Gemini',
};

/**
 * Each provider's setup pages, linked from the extension's Settings → AI once the provider is
 * picked: `guide` explains how to create an API key, `keys` is the page that lists the account's
 * keys (create, revoke, set limits). Checked 2026-10-24; Anthropic's old
 * `console.anthropic.com/settings/keys` now redirects to the `keys` URL here.
 */
export const AI_PROVIDER_KEY_LINKS: Record<AiProvider, { guide: string; keys: string }> = {
  anthropic: {
    guide: 'https://platform.claude.com/docs/en/get-api-key',
    keys: 'https://platform.claude.com/settings/keys',
  },
  openai: {
    guide: 'https://developers.openai.com/api/docs/quickstart',
    keys: 'https://platform.openai.com/api-keys',
  },
  google: {
    guide: 'https://ai.google.dev/gemini-api/docs/api-key',
    keys: 'https://aistudio.google.com/apikey',
  },
};

export const AI_MODEL_IDS = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'gpt-6-luna',
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-argon',
] as const;

export type AiModelId = (typeof AI_MODEL_IDS)[number];

/** List prices, in US cents per million tokens. */
interface TokenPrices {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
  /**
   * Prompt-cache hits (and refreshes). Set on the Claude models, whose cache use is metered.
   * Own-key models leave it out: their usage is never metered, and an estimate without it prices
   * cached input at the full input rate (never lower than the real bill).
   */
  cacheReadCentsPerMTok?: number;
}

/**
 * What a Claude prompt-cache write costs, as a multiple of the base input price: 1.25x for the
 * default 5-minute cache, 2x for the 1-hour cache (TabMerger only writes 5-minute entries).
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-25).
 */
export const AI_CACHE_WRITE_MULTIPLIER = { ephemeral5m: 1.25, ephemeral1h: 2 } as const;

export interface AiModelInfo extends TokenPrices {
  id: AiModelId;
  provider: AiProvider;
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

/**
 * Every model a request can name, with its list prices (checked 2026-10-22). OpenAI and Google
 * models are own-key only, so their prices only feed the dollar estimates in Settings; where a
 * price rise is already announced, the higher price is used so estimates don't read low.
 *
 * Claude cache-read prices (checked 2026-10-25 against
 * https://platform.claude.com/docs/en/about-claude/pricing): Haiku 5.5 $0.01/MTok ($0.05 over
 * 100K prompt tokens, the same tier switch as its input price), Sonnet 5.5 $0.10 and Opus 5.5
 * $0.20 (both 0.05x their base input). Cache writes are {@link AI_CACHE_WRITE_MULTIPLIER} times
 * the base input price.
 */
export const AI_MODELS: Record<AiModelId, AiModelInfo> = {
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    inputCentsPerMTok: 10,
    outputCentsPerMTok: 50,
    cacheReadCentsPerMTok: 1,
    longContext: { thresholdTokens: 100_000, inputCentsPerMTok: 50, outputCentsPerMTok: 250, cacheReadCentsPerMTok: 5 },
    typicalThinkingTokens: 0,
  },
  'claude-sonnet-5-5': {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    inputCentsPerMTok: 200,
    outputCentsPerMTok: 1000,
    cacheReadCentsPerMTok: 10,
    typicalThinkingTokens: 0,
  },
  'claude-opus-5-5': {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Claude Opus 5.5',
    inputCentsPerMTok: 400,
    outputCentsPerMTok: 2000,
    cacheReadCentsPerMTok: 20,
    // Thinking can't be turned off on Opus 5.5; effort `low` keeps it short.
    typicalThinkingTokens: 300,
  },
  'gpt-6-luna': {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    inputCentsPerMTok: 10,
    outputCentsPerMTok: 50,
    longContext: { thresholdTokens: 272_000, inputCentsPerMTok: 20, outputCentsPerMTok: 75 },
    typicalThinkingTokens: 0,
  },
  'gpt-6.1-sol': {
    id: 'gpt-6.1-sol',
    provider: 'openai',
    label: 'GPT-6.1 Sol',
    inputCentsPerMTok: 200,
    outputCentsPerMTok: 1000,
    longContext: { thresholdTokens: 272_000, inputCentsPerMTok: 400, outputCentsPerMTok: 1500 },
    typicalThinkingTokens: 200,
  },
  'gpt-6-astra': {
    id: 'gpt-6-astra',
    provider: 'openai',
    label: 'GPT-6 Astra',
    inputCentsPerMTok: 1000,
    outputCentsPerMTok: 5000,
    longContext: { thresholdTokens: 272_000, inputCentsPerMTok: 2000, outputCentsPerMTok: 7500 },
    typicalThinkingTokens: 300,
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    provider: 'google',
    label: 'Gemini 3.1 Flash-Lite',
    inputCentsPerMTok: 25,
    outputCentsPerMTok: 150,
    typicalThinkingTokens: 0,
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    provider: 'google',
    label: 'Gemini 3.8 Flash',
    // $0.75 / $3.75 until 2026-12-31; the announced 2027 price is used.
    inputCentsPerMTok: 150,
    outputCentsPerMTok: 750,
    typicalThinkingTokens: 200,
  },
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    provider: 'google',
    label: 'Gemini 4 Argon',
    // $2 / $10 until 2026-11-30; the announced December price is used.
    inputCentsPerMTok: 400,
    outputCentsPerMTok: 2000,
    typicalThinkingTokens: 300,
  },
};

export function isAiModelId(value: unknown): value is AiModelId {
  return typeof value === 'string' && (AI_MODEL_IDS as readonly string[]).includes(value);
}

/** One provider's models, cheapest first (the order of {@link AI_MODEL_IDS}). */
export function aiModelsForProvider(provider: AiProvider): AiModelId[] {
  return AI_MODEL_IDS.filter((id) => AI_MODELS[id].provider === provider);
}

/** What the user picks in Settings: a fixed model, or `auto` to let each feature use its default. */
export type AiModelChoice = 'auto' | AiModelId;

export const AI_MODEL_CHOICES: readonly AiModelChoice[] = ['auto', ...AI_MODEL_IDS];

export const DEFAULT_AI_MODEL_CHOICE: AiModelChoice = 'auto';

export const AI_ACTIONS = ['nameGroup', 'tabSummary', 'groupTabs', 'suggestSessions', 'organize', 'describeGroup'] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

/**
 * The longest description `POST /api/ai/describe-group` returns (characters, after cleaning). The
 * extension writes it into the group's note, so it is short enough to read at a glance.
 */
export const AI_MAX_GROUP_DESCRIPTION_LENGTH = 300;

/**
 * How many names `POST /api/ai/name-group` asks the model for. The answer's `names` holds 1 to
 * this many distinct suggestions, best first (fewer when some were empty or duplicates).
 */
export const AI_NAME_GROUP_SUGGESTIONS = 3;

/**
 * What the suggest-sessions banner offers for the groups a suggestion names: `merge` folds them
 * into the first one, `archive` archives them. A merge needs at least two groups.
 */
export const AI_SUGGESTION_KINDS = ['merge', 'archive'] as const;

export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];

/** Whether a value read from a model reply or stored suggestion is an {@link AiSuggestionKind}. */
export function isAiSuggestionKind(value: unknown): value is AiSuggestionKind {
  return typeof value === 'string' && (AI_SUGGESTION_KINDS as readonly string[]).includes(value);
}

/** The model `auto` uses for each feature on Anthropic: the cheapest one that does the job well. */
export const AUTO_AI_MODEL: Record<AiAction, AiModelId> = {
  nameGroup: 'claude-haiku-5-5',
  tabSummary: 'claude-haiku-5-5',
  groupTabs: 'claude-haiku-5-5',
  suggestSessions: 'claude-haiku-5-5',
  organize: 'claude-sonnet-5-5',
  describeGroup: 'claude-haiku-5-5',
};

/** What `auto` uses for each feature, per provider (same rule: cheap model, mid model for organize). */
export const AUTO_AI_MODELS: Record<AiProvider, Record<AiAction, AiModelId>> = {
  anthropic: AUTO_AI_MODEL,
  openai: {
    nameGroup: 'gpt-6-luna',
    tabSummary: 'gpt-6-luna',
    groupTabs: 'gpt-6-luna',
    suggestSessions: 'gpt-6-luna',
    organize: 'gpt-6.1-sol',
    describeGroup: 'gpt-6-luna',
  },
  google: {
    nameGroup: 'gemini-3.1-flash-lite',
    tabSummary: 'gemini-3.1-flash-lite',
    groupTabs: 'gemini-3.1-flash-lite',
    suggestSessions: 'gemini-3.1-flash-lite',
    organize: 'gemini-3.8-flash',
    describeGroup: 'gemini-3.1-flash-lite',
  },
};

/**
 * The model a request runs on, for the provider it goes to (managed: always Anthropic; own key:
 * the key's provider, see {@link byokKeyProvider}). A missing choice (or `auto`) uses the
 * feature's default on that provider; a model that isn't known, or belongs to another provider,
 * returns `null`, which the server answers with `ai_model_invalid`.
 */
export function resolveAiModel(
  choice: unknown,
  action: AiAction,
  provider: AiProvider = MANAGED_AI_PROVIDER,
): AiModelId | null {
  if (choice === undefined || choice === null || choice === 'auto') return AUTO_AI_MODELS[provider][action];
  return isAiModelId(choice) && AI_MODELS[choice].provider === provider ? choice : null;
}

// --- Cost of a call -----------------------------------------------------------

/** 1 cent per million tokens, per token, is 1e-8 dollars; a credit ($0.001) is 100,000 of those. */
const PRICE_UNITS_PER_CREDIT = 100_000;

/**
 * A call's token usage, split the way Claude bills it (`response.usage`):
 * - `inputTokens`: input processed normally, at the base input price (Anthropic `input_tokens`,
 *   the part after the last cache breakpoint or the whole prompt when nothing was cached);
 * - `cacheWrite5mTokens` / `cacheWrite1hTokens`: input written to the prompt cache, at
 *   {@link AI_CACHE_WRITE_MULTIPLIER} times the base input price;
 * - `cacheReadTokens`: input read from the cache, at the model's `cacheReadCentsPerMTok`;
 * - `outputTokens`: the answer, thinking included.
 * The long-context price tier is chosen by the total input (all four input fields).
 */
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
}

/** Token counts as non-negative whole numbers (fractions round up). */
function wholeTokens(n: number | undefined): number {
  return Math.max(0, Math.ceil(n ?? 0));
}

function normalizeUsage(usage: AiTokenUsage): Required<AiTokenUsage> {
  return {
    inputTokens: wholeTokens(usage.inputTokens),
    outputTokens: wholeTokens(usage.outputTokens),
    cacheWrite5mTokens: wholeTokens(usage.cacheWrite5mTokens),
    cacheWrite1hTokens: wholeTokens(usage.cacheWrite1hTokens),
    cacheReadTokens: wholeTokens(usage.cacheReadTokens),
  };
}

function totalInputTokens(u: Required<AiTokenUsage>): number {
  return u.inputTokens + u.cacheWrite5mTokens + u.cacheWrite1hTokens + u.cacheReadTokens;
}

function pricesFor(model: AiModelId, inputTokens: number): TokenPrices {
  const info = AI_MODELS[model];
  return info.longContext && inputTokens > info.longContext.thresholdTokens ? info.longContext : info;
}

function priceUnits(model: AiModelId, u: Required<AiTokenUsage>): number {
  return priceUnitsAt(pricesFor(model, totalInputTokens(u)), u);
}

function priceUnitsAt(prices: TokenPrices, u: Required<AiTokenUsage>): number {
  const input = prices.inputCentsPerMTok;
  // No cache-read price (own-key models): price reads like normal input, never lower than the bill.
  const read = prices.cacheReadCentsPerMTok ?? input;
  return (
    u.inputTokens * input +
    u.cacheWrite5mTokens * input * AI_CACHE_WRITE_MULTIPLIER.ephemeral5m +
    u.cacheWrite1hTokens * input * AI_CACHE_WRITE_MULTIPLIER.ephemeral1h +
    u.cacheReadTokens * read +
    u.outputTokens * prices.outputCentsPerMTok
  );
}

function toUsage(usageOrInput: AiTokenUsage | number, outputTokens: number | undefined): AiTokenUsage {
  return typeof usageOrInput === 'number' ? { inputTokens: usageOrInput, outputTokens: outputTokens ?? 0 } : usageOrInput;
}

/**
 * Credits a call costs: its list-price cost rounded up to whole credits, at least 1 when it used
 * any tokens and 0 when it used none. Takes the full usage breakdown ({@link AiTokenUsage}), or
 * `(inputTokens, outputTokens)` for a call with no prompt caching (all input at the base price).
 * `outputTokens` includes thinking tokens. Settling a managed call uses the real usage; the
 * worst-case reservation is {@link aiReservationCredits}.
 */
export function aiCallCredits(model: AiModelId, usage: AiTokenUsage): number;
export function aiCallCredits(model: AiModelId, inputTokens: number, outputTokens: number): number;
export function aiCallCredits(model: AiModelId, usageOrInput: AiTokenUsage | number, outputTokens?: number): number {
  const u = normalizeUsage(toUsage(usageOrInput, outputTokens));
  if (totalInputTokens(u) + u.outputTokens === 0) return 0;
  return Math.max(1, Math.ceil(priceUnits(model, u) / PRICE_UNITS_PER_CREDIT));
}

/**
 * Extra input, in percent of the counted tokens, that a reservation covers: `count_tokens` is an
 * estimate, and the billed total can come out a little higher.
 */
export const AI_RESERVE_INPUT_MARGIN_PERCENT = 2;

/**
 * The most a managed call can cost, reserved before the model is called: the counted input plus
 * {@link AI_RESERVE_INPUT_MARGIN_PERCENT}, every token priced as a 5-minute cache write (the
 * dearest way input can be billed, since TabMerger only writes 5-minute entries), and
 * `maxOutputTokens` of output. The real usage splits its input into base, write and read
 * tokens, each priced at or below the write rate, so settling only refunds as long as the real
 * total input stays within the margin of the count.
 *
 * The price tier is chosen from the padded input, so a count within about 2% of a model's
 * long-context threshold is already reserved at the long-context prices: a call whose real
 * total lands just over the threshold (where settling uses those prices) is still covered.
 * Non-finite input gives `NaN`; callers must not reserve it.
 */
export function aiReservationCredits(model: AiModelId, countedInputTokens: number, maxOutputTokens: number): number {
  const counted = wholeTokens(countedInputTokens);
  const padded = counted + Math.ceil((counted * AI_RESERVE_INPUT_MARGIN_PERCENT) / 100);
  return aiCallCredits(model, { inputTokens: 0, cacheWrite5mTokens: padded, outputTokens: maxOutputTokens });
}

/** The same cost in US dollars, for showing a BYOK user what their provider will bill them. */
export function aiCallCostUsd(model: AiModelId, usage: AiTokenUsage): number;
export function aiCallCostUsd(model: AiModelId, inputTokens: number, outputTokens: number): number;
export function aiCallCostUsd(model: AiModelId, usageOrInput: AiTokenUsage | number, outputTokens?: number): number {
  const usage = toUsage(usageOrInput, outputTokens);
  // Fractions are kept here (estimates); only negatives are clamped.
  const clamp = (n: number | undefined) => Math.max(0, n ?? 0);
  return (
    priceUnits(model, {
      inputTokens: clamp(usage.inputTokens),
      outputTokens: clamp(usage.outputTokens),
      cacheWrite5mTokens: clamp(usage.cacheWrite5mTokens),
      cacheWrite1hTokens: clamp(usage.cacheWrite1hTokens),
      cacheReadTokens: clamp(usage.cacheReadTokens),
    }) / 1e8
  );
}

// --- Estimates for the Settings model picker ------------------------------------

/** Rough token counts for estimates only: a tab's title and URL, and each prompt's fixed text. */
const ESTIMATE_TOKENS_PER_TAB = 60;
const ESTIMATE_PROMPT_OVERHEAD_TOKENS = 300;

function estimatedOutputTokens(action: AiAction, tabs: number): number {
  switch (action) {
    case 'nameGroup':
      // AI_NAME_GROUP_SUGGESTIONS (3) names of up to 30 characters, about 8 tokens each, plus the JSON.
      return 40;
    case 'tabSummary':
      return 40;
    case 'groupTabs':
      return 100 + 5 * tabs;
    case 'suggestSessions':
      return 100;
    case 'organize':
      return 300 + 4 * tabs;
    case 'describeGroup':
      // At most AI_MAX_GROUP_DESCRIPTION_LENGTH (300) characters, about 75 tokens, plus the JSON.
      return 90;
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

/** Approximate provider cost in US dollars of one action, for BYOK users. */
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

/**
 * Request header that carries a BYOK user's key to `/api/ai/*`. Never stored server-side. The
 * provider is read from the key's shape ({@link byokKeyProvider}), so no second header is needed.
 */
export const AI_BYOK_KEY_HEADER = 'X-AI-Key';

/**
 * The shape of each provider's API key, checked before a key is saved and before it is forwarded.
 * OpenAI: project (`sk-proj-`), service-account (`sk-svcacct-`) and legacy user keys; admin keys
 * (`sk-admin-`) can't run models and are rejected. Google: Gemini API keys (`AIza` + 35).
 */
export const AI_API_KEY_PATTERNS: Record<AiProvider, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,300}$/,
  openai: /^sk-(?!ant-|admin-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,300}$/,
  google: /^AIza[A-Za-z0-9_-]{35}$/,
};

/** @deprecated Use `AI_API_KEY_PATTERNS.anthropic`. */
export const ANTHROPIC_API_KEY_PATTERN = AI_API_KEY_PATTERNS.anthropic;

/** Which provider issued `value`, read from its shape, or `null` when it isn't a usable key. */
export function byokKeyProvider(value: unknown): AiProvider | null {
  if (typeof value !== 'string') return null;
  return AI_PROVIDERS.find((provider) => AI_API_KEY_PATTERNS[provider].test(value)) ?? null;
}

/** Whether `value` is a key from any supported provider. */
export function isByokApiKey(value: unknown): value is string {
  return byokKeyProvider(value) !== null;
}

export function isAnthropicApiKey(value: unknown): value is string {
  return byokKeyProvider(value) === 'anthropic';
}

const KEY_MASK_PREFIX: Record<AiProvider, string> = { anthropic: 'sk-ant-', openai: 'sk-', google: 'AIza' };

/** A key as shown after it's saved: `sk-ant-…abcd`, `sk-…abcd` or `AIza…abcd`. */
export function maskApiKey(key: string): string {
  const provider = byokKeyProvider(key) ?? 'anthropic';
  return `${KEY_MASK_PREFIX[provider]}…${key.slice(-4)}`;
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
