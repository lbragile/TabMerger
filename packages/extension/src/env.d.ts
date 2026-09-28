/// <reference types="vite/client" />

declare module '*.png' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_WEB_APP_URL: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_DEMO_BUILD?: string;
  readonly VITE_AI_ENABLED?: string;
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The real semver string this build resolves to (e.g. "3.1.0-beta.6"), injected via a Vite
 * `define` in wxt.config.ts (`rawVersionString`) — the same input `resolveManifestVersion` maps
 * onto the manifest's `version`/`version_name` split. Exists because Firefox drops the
 * Chrome-only `version_name` manifest field, so `chrome.runtime.getManifest().version_name` is
 * always undefined there; the Settings version badge falls back to this instead of the offset
 * store version. See src/components/Modal/Settings.tsx.
 */
declare const __TABMERGER_VERSION__: string;
