---
name: signed-in-dashboard-probe
description: How to render /dashboard signed in (free and Pro) headlessly against local Supabase, and the fallback when the chrome-devtools MCP profile is locked by another session
metadata:
  type: reference
---

- **[2026-10]** chrome-devtools MCP uses one persistent profile; if another Claude session has it open,
  every call fails with "The browser is already running for ...chrome-devtools-mcp\chrome-profile".
  Fallback: a small Node script in the scratchpad that requires the repo's own Playwright
  (`node_modules/.pnpm/@playwright+test@<ver>/node_modules/playwright`) and calls
  `chromium.launch({ headless: true })`. Use a fresh `browser.newContext()` per account.
- Signed-in dashboard without OAuth: create throwaway users with the local GoTrue admin API
  (`POST http://127.0.0.1:54321/auth/v1/admin/users` with `email_confirm: true` and a password, using
  the SERVICE_ROLE_KEY from `npx supabase status -o env`), then sign in through `/auth/sign-in`
  (email + password inputs, first submit button) and wait for `/dashboard`.
  `handle_new_user()` already creates a free `subscriptions` row: PATCH it to `tier: pro, status: active`
  for a Pro account (never insert a second row; `user_id` is unique).
- Plaintext `sessions` rows (no `{v:1,...}` blob) render as saved sessions; they can never show up as
  backups, because "backup" is only known from decrypted content (`auto: true`). Testing the backup
  rows needs an encrypted row.
- Clean up with `DELETE /auth/v1/admin/users/<id>` (cascades to profile, subscription, sessions).
