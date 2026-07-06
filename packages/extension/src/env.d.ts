/// <reference types="vite/client" />

declare module '*.png' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_WEB_APP_URL: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
