/**
 * Firefox's `browser.permissions` "data collection" categories TabMerger actually declares and
 * requests, per AMO's data-collection-consent rule (extensionworkshop.com, "Firefox Built-in Data
 * Collection Consent" — mandatory for add-ons created after 2025-11-03; see
 * `packages/extension/FIREFOXADDONS.md`). One typed list, shared by:
 *   - `wxt.config.ts`'s `browser_specific_settings.gecko.data_collection_permissions.optional`
 *     (the manifest declaration)
 *   - `src/lib/dataConsent.ts`'s `hasDataConsent`/`requestDataConsent` (the runtime `permissions`
 *     API calls, which must ask for exactly the categories the manifest declared)
 * so the two can never drift out of sync.
 *
 * Deliberately excludes `websiteContent` (page text/images) — nothing in this codebase transmits
 * page content off-device. What TabMerger actually sends and why each category applies:
 *   - `browsingActivity` (URLs/domains visited) — tab URLs sent for the opt-in page-image preview
 *     (`src/lib/tabAccess.ts`'s `/api/og-preview` call) and tab URLs/titles included in cloud sync
 *     uploads (`src/lib/syncEngine.ts`) — end-to-end encrypted client-side, but the ciphertext
 *     still leaves the browser, and Firefox's consent model is about what leaves the device, not
 *     whether the destination can read it.
 *   - `authenticationInfo` / `personallyIdentifyingInfo` — email + Supabase session on sign-in
 *     (`src/components/Modal/Auth.tsx`, every entry point: email/password, sign-up, magic link,
 *     Google OAuth).
 *   - `technicalAndInteraction` — anonymous GA4/PostHog usage events (`src/lib/analytics.ts`).
 *     AMO's schema only allows this category under `optional` (never `required`), and shows it to
 *     Firefox users as an install-time opt-in checkbox rather than a runtime `permissions.request`
 *     prompt — but the extension code must still not send events unless it reads back as granted.
 */
export const FIREFOX_DATA_CONSENT_CATEGORIES = [
  'technicalAndInteraction',
  'browsingActivity',
  'authenticationInfo',
  'personallyIdentifyingInfo',
] as const;

export type FirefoxDataConsentCategory = (typeof FIREFOX_DATA_CONSENT_CATEGORIES)[number];

/** Requested before/around sign-in (every entry point in the Auth modal) — sign-in also enables sync. */
export const SIGN_IN_DATA_CONSENT_CATEGORIES: readonly FirefoxDataConsentCategory[] = [
  'authenticationInfo',
  'personallyIdentifyingInfo',
  'browsingActivity',
];

/** Requested when the user turns on Settings → "Show page images in previews". */
export const PREVIEW_IMAGES_DATA_CONSENT_CATEGORIES: readonly FirefoxDataConsentCategory[] = [
  'browsingActivity',
];

/** Required before any cloud-sync upload proceeds. */
export const SYNC_DATA_CONSENT_CATEGORIES: readonly FirefoxDataConsentCategory[] = ['browsingActivity'];

/** Required before analytics events (`trackEvent`/`trackPostHogEvent`) are sent. */
export const ANALYTICS_DATA_CONSENT_CATEGORIES: readonly FirefoxDataConsentCategory[] = [
  'technicalAndInteraction',
];
