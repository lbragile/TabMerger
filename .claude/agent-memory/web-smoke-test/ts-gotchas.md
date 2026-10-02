---
name: ts-gotchas
description: Recurring TypeScript issues in packages/web — Stripe API version type mismatch, Supabase SSR implicit-any cookie callbacks, empty interface lint violations
metadata:
  type: feedback
---

- **[2026-07]** `stripe@16.x` types only know `"2024-06-20"` as `LatestApiVersion`. Using a newer preview version like `"2025-06-30.basil"` requires casting with `as any` or upgrading to a newer Stripe SDK. The cast is in `lib/stripe.ts`.
  **Why:** Stripe SDK TypeScript types ship with a hardcoded union of supported API versions; preview/beta versions are not included.
  **How to apply:** When bumping the Stripe API version string, check if the SDK version supports it or add `as any` cast on `apiVersion`.

- **[2026-07]** `@supabase/ssr@0.5.x` does not infer parameter types for the `setAll` cookies callback. TypeScript reports `'cookiesToSet' implicitly has 'any' type` in both `lib/supabase/server.ts` and `middleware.ts`. Fix: import `CookieOptions` from `@supabase/ssr` and annotate as `cookiesToSet: { name: string; value: string; options: CookieOptions }[]`.
  **Why:** Contextual typing does not propagate through the `createServerClient` config object into nested callback parameters in this version.
  **How to apply:** Whenever the Supabase server client setup is copy-pasted into a new file, add explicit types to `setAll`.

- **[2026-07]** shadcn/ui `input.tsx` and `textarea.tsx` ship with empty `interface` declarations (`interface InputProps extends React.InputHTMLAttributes<"input"> {}`). The `@typescript-eslint/no-empty-object-type` rule flags these. Fix: change `interface` to `type` (e.g. `export type InputProps = React.InputHTMLAttributes<HTMLInputElement>`).
  **Why:** shadcn/ui generated files use the empty interface pattern which conflicts with the TypeScript ESLint rule.
  **How to apply:** After running `npx shadcn-ui add <component>`, check the generated file for empty interfaces and convert to type aliases.
