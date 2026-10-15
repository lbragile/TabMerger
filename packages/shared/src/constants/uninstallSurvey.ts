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
  channel: 'c'
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
  info: { version?: string; browser?: string; channel?: string }
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
  return url.toString();
}

/**
 * Keeps only the values that are a known version shape, browser and channel. Used on both ends:
 * the URL comes from the address bar, so anyone can type anything into it.
 */
export function parseUninstallSurveyParams(raw: { version?: unknown; browser?: unknown; channel?: unknown }): {
  version?: string;
  browser?: UninstallSurveyBrowser;
  channel?: UninstallSurveyChannel;
} {
  const version = typeof raw.version === 'string' && UNINSTALL_SURVEY_VERSION_RE.test(raw.version) ? raw.version : undefined;
  const browser = UNINSTALL_SURVEY_BROWSERS.find((b) => b === raw.browser);
  const channel = UNINSTALL_SURVEY_CHANNELS.find((c) => c === raw.channel);
  return { version, browser, channel };
}

/** True for an id in {@link UNINSTALL_SURVEY_REASONS}. */
export function isUninstallSurveyReasonId(value: unknown): value is UninstallSurveyReasonId {
  return UNINSTALL_SURVEY_REASONS.some((r) => r.id === value);
}
