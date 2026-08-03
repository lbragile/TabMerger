import { test as setup } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Playwright "setup project" (https://playwright.dev/docs/auth) that mints a
 * real, ephemeral Supabase session and writes it into storageState so the
 * `authenticated` project's tests load pages already signed in.
 *
 * No email round-trip: admin.generateLink() produces a magic-link token
 * server-side, which we immediately redeem with verifyOtp() using the
 * service-role-adjacent anon client. This is the standard way to bypass
 * magic-link delivery in E2E (Supabase has no "mint session directly" API).
 *
 * The ephemeral user's id is stashed in .auth/user-id.txt so the global
 * teardown (auth.teardown.ts) can delete it after the run.
 */

const AUTH_DIR = path.join(__dirname, '.auth')
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'user.json')
const USER_ID_PATH = path.join(AUTH_DIR, 'user-id.txt')

setup('authenticate ephemeral test user', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  // App code (lib/supabase/client.ts, server.ts) reads
  // NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — .env.example still says
  // NEXT_PUBLIC_SUPABASE_ANON_KEY, which is stale; accept either here.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'auth.setup.ts requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY to be set.'
    )
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const email = `e2e-${Date.now()}-${process.pid}@tabmerger-e2e.test`
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    throw new Error(`Failed to create ephemeral test user: ${createErr?.message}`)
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !linkData.properties?.hashed_token) {
    throw new Error(`Failed to generate magic link for test user: ${linkErr?.message}`)
  }

  // Redeem the token with a plain (anon-key) client — this is what mints the
  // actual access/refresh token pair a real signed-in browser would have.
  const anon = createClient(url, anonKey)
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  })
  if (verifyErr || !verified.session) {
    throw new Error(`Failed to verify OTP for test user: ${verifyErr?.message}`)
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true })
  fs.writeFileSync(USER_ID_PATH, created.user.id)

  // @supabase/ssr's browser client persists the session as a cookie (NOT
  // localStorage) named `sb-<project-ref>-auth-token`, holding
  // `base64-` + base64(JSON.stringify(session)). Project ref is the
  // subdomain of the Supabase URL. This must match exactly or the
  // middleware/server client will treat the request as unauthenticated.
  const projectRef = new URL(url).hostname.split('.')[0]
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(verified.session)).toString('base64')

  const storageState = {
    cookies: [
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2))
})
