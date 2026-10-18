/**
 * Uninstall survey: the page the browser opens after the extension is removed, and the form it
 * posts. Shared so the extension (which builds the URL), the page and the API route agree on the
 * path, the query parameters, the answer list and every length limit.
 */

/** Web app path the browser opens after an uninstall. */
export const UNINSTALL_SURVEY_PATH = '/uninstalled';

/** API route the survey form posts to. */
export const UNINSTALL_SURVEY_API_PATH = '/api/uninstall-feedback';

/** Query parameters the extension adds to the survey URL. None of them identifies a person. */
export const UNINSTALL_SURVEY_PARAMS = {
  /** Extension version, e.g. `3.1.2`. */
  version: 'v',
  /** Browser the extension was built for. */
  browser: 'b',
  /** Release channel. */
  channel: 'c',
  /**
   * Whether the install may send anonymous usage analytics: `1` yes, `0` no. On Firefox this is the
   * `technicalAndInteraction` data-collection consent; Chrome and Edge builds always send `1`
   * (analytics there need no separate opt-in). The web app only counts the uninstall when it is
   * `1`, or, for URLs registered before this flag existed, when the browser is Chrome or Edge.
   */
  analytics: 'a'
} as const;

export const UNINSTALL_SURVEY_BROWSERS = ['chrome', 'firefox', 'edge'] as const;
export type UninstallSurveyBrowser = (typeof UNINSTALL_SURVEY_BROWSERS)[number];

export const UNINSTALL_SURVEY_CHANNELS = ['stable', 'beta'] as const;
export type UninstallSurveyChannel = (typeof UNINSTALL_SURVEY_CHANNELS)[number];

/** A manifest version: one to four dot-separated numbers. */
export const UNINSTALL_SURVEY_VERSION_RE = /^\d{1,5}(?:\.\d{1,5}){0,3}$/;

/** Answers to "Why did you remove TabMerger?". `id` is what the form sends; `label` is what people read. */
export const UNINSTALL_SURVEY_REASONS = [
  { id: 'hard-to-use', label: 'It was confusing or hard to use' },
  { id: 'missing-feature', label: 'It is missing something I need' },
  { id: 'bug', label: 'Something did not work' },
  { id: 'lost-data', label: 'I lost tabs or groups' },
  { id: 'slow', label: 'It slowed my browser down' },
  { id: 'price', label: 'The paid plans cost too much' },
  { id: 'switched', label: 'I switched to another extension' },
  { id: 'not-needed', label: 'I no longer need it' },
  { id: 'temporary', label: 'I am reinstalling or it is only temporary' },
  { id: 'other', label: 'Something else' }
] as const;

export type UninstallSurveyReasonId = (typeof UNINSTALL_SURVEY_REASONS)[number]['id'];

export const UNINSTALL_SURVEY_LIMITS = {
  /** Most reasons one answer can tick. */
  reasons: UNINSTALL_SURVEY_REASONS.length,
  /** Free-text comment. */
  details: 2000,
  /** Optional reply address (the longest a mailbox address can be). */
  email: 254
} as const;

/**
 * The survey URL for one build, or `undefined` when the web app address is missing or is not an
 * http(s) URL. Values that are not a known browser, channel or version are left out, and the
 * result stays far below the 1023 characters `runtime.setUninstallURL` accepts.
 */
export function buildUninstallSurveyUrl(
  webAppUrl: string | undefined,
  info: { version?: string; browser?: string; channel?: string; analytics?: boolean }
): string | undefined {
  if (!webAppUrl) return undefined;
  let url: URL;
  try {
    url = new URL(UNINSTALL_SURVEY_PATH, webAppUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const { version, browser, channel } = parseUninstallSurveyParams(info);
  if (version) url.searchParams.set(UNINSTALL_SURVEY_PARAMS.version, version);
  if (browser) url.searchParams.set(UNINSTALL_SURVEY_PARAMS.browser, browser);
  if (channel) url.searchParams.set(UNINSTALL_SURVEY_PARAMS.channel, channel);
  if (typeof info.analytics === 'boolean') url.searchParams.set(UNINSTALL_SURVEY_PARAMS.analytics, info.analytics ? '1' : '0');
  return url.toString();
}

/**
 * Keeps only the values that are a known version shape, browser and channel. Used on both ends:
 * the URL comes from the address bar, so anyone can type anything into it.
 */
export function parseUninstallSurveyParams(raw: {
  version?: unknown;
  browser?: unknown;
  channel?: unknown;
  analytics?: unknown;
}): {
  version?: string;
  browser?: UninstallSurveyBrowser;
  channel?: UninstallSurveyChannel;
  analytics?: boolean;
} {
  const version = typeof raw.version === 'string' && UNINSTALL_SURVEY_VERSION_RE.test(raw.version) ? raw.version : undefined;
  const browser = UNINSTALL_SURVEY_BROWSERS.find((b) => b === raw.browser);
  const channel = UNINSTALL_SURVEY_CHANNELS.find((c) => c === raw.channel);
  const analytics = raw.analytics === '1' ? true : raw.analytics === '0' ? false : undefined;
  return { version, browser, channel, analytics };
}

/** Browsers whose builds send analytics without a separate opt-in (no Firefox-style data consent). */
const NO_CONSENT_NEEDED_BROWSERS: readonly UninstallSurveyBrowser[] = ['chrome', 'edge'];

/**
 * Whether the web app may record an `extension_uninstalled` analytics event for these (already
 * parsed) survey params. An explicit `analytics` flag wins; without one (a URL registered by a
 * build older than the flag) only Chrome and Edge count, because those builds sent analytics
 * without asking. An unknown browser could be Firefox, so it does not count.
 */
export function uninstallAnalyticsAllowed(params: { browser?: UninstallSurveyBrowser; analytics?: boolean }): boolean {
  if (params.analytics !== undefined) return params.analytics;
  return params.browser !== undefined && NO_CONSENT_NEEDED_BROWSERS.includes(params.browser);
}

/** True for an id in {@link UNINSTALL_SURVEY_REASONS}. */
export function isUninstallSurveyReasonId(value: unknown): value is UninstallSurveyReasonId {
  return UNINSTALL_SURVEY_REASONS.some((r) => r.id === value);
}
