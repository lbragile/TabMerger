import { test as teardown } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Deletes the ephemeral test user created by auth.setup.ts, and removes the
 * storageState file so a stale session can't leak into the next run.
 */

const AUTH_DIR = path.join(__dirname, '.auth')
const USER_ID_PATH = path.join(AUTH_DIR, 'user-id.txt')

teardown('delete ephemeral test user', async () => {
  if (!fs.existsSync(USER_ID_PATH)) return

  const userId = fs.readFileSync(USER_ID_PATH, 'utf-8').trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && serviceRoleKey && userId) {
    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await admin.auth.admin.deleteUser(userId)
  }

  fs.rmSync(AUTH_DIR, { recursive: true, force: true })
})
