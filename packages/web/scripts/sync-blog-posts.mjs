#!/usr/bin/env node
/**
 * Registers the blog's posts in the database so their Helpful button can take votes: sends every
 * post slug in content/blog to `sync_blog_posts(p_slugs, p_token)`, which adds the new ones (and
 * reports or removes the ones no longer in the list). The deploy jobs run it after each web deploy,
 * and `pnpm dev:all` runs it against local Supabase, so a new post needs no migration.
 *
 *   node scripts/sync-blog-posts.mjs [--env-file <path>] [--dry-run]
 *
 * The slug list comes from `scanBlogContent` (scripts/generate-blog-index.mjs) with placeholders
 * off: exactly the posts the generated index lists, scheduled ones included (a scheduled post's
 * page goes live on its date with no deploy, so its row must already exist).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ..._ANON_KEY: the public
 * key every client ships) and BLOG_SYNC_TOKEN (the secret the RPC checks). `--env-file` reads them
 * from a dotenv file first, e.g. `.vercel/.env.production.local` written by `vercel pull`; real
 * environment variables win over the file. Exits 1 on a missing variable or an RPC error. Never
 * prints the token or the key.
 *
 * Plain JavaScript with Node built-ins (and global fetch) only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOG_CONTENT_DIR, scanBlogContent } from './generate-blog-index.mjs'

/** The RPC the database exposes for this (migration 035). */
export const SYNC_RPC = 'sync_blog_posts'

/** Every post slug in `dir`, sorted, without dev-only placeholders, scheduled posts included. */
export function blogSlugs(dir = BLOG_CONTENT_DIR) {
  return Object.keys(scanBlogContent(dir, { placeholders: false })).sort()
}

/**
 * A dotenv file's variables: `KEY=value` lines, optional `export `, `#` comments and blank lines
 * skipped, one pair of surrounding single or double quotes removed.
 */
export function parseEnvFile(text) {
  const vars = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    vars[match[1]] = value
  }
  return vars
}

/** The three settings the sync needs, or the names of the missing ones. */
export function readConfig(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim()
  const token = env.BLOG_SYNC_TOKEN?.trim()
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !key && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    !token && 'BLOG_SYNC_TOKEN',
  ].filter(Boolean)
  return missing.length ? { missing } : { url: url.replace(/\/+$/, ''), key, token, missing: [] }
}

/** `text` with every secret replaced by `***`, so nothing printed can leak one. */
export function redact(text, secrets) {
  let out = String(text)
  for (const secret of secrets) if (secret) out = out.split(secret).join('***')
  return out
}

/**
 * Calls the RPC over PostgREST with the public key, and answers its result
 * (`{ added, missing, deleted }`). Throws with the server's message on any other answer.
 */
export async function syncBlogPosts({ url, key, token, slugs, fetchImpl = fetch }) {
  const response = await fetchImpl(`${url}/rest/v1/rpc/${SYNC_RPC}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slugs: slugs, p_token: token }),
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const detail = body?.message ?? body?.error ?? (text || response.statusText)
    throw new Error(`${SYNC_RPC} failed (HTTP ${response.status}): ${detail}`)
  }
  return body ?? {}
}

/** One result field ("added: 2 (a, b)"): a list's size and items, or a count as it is. */
export function describe(name, value) {
  if (Array.isArray(value)) return `${name}: ${value.length}${value.length ? ` (${value.join(', ')})` : ''}`
  return `${name}: ${value ?? 0}`
}

/** How many items a result field holds: a list's length, or the count as it is. */
export function countOf(value) {
  if (Array.isArray(value)) return value.length
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** The SQL that lists the posts the database counts as missing from the deploy's list. */
export const MISSING_POSTS_SQL = 'select slug, missing_since from public.blog_posts where missing_since is not null;'

/**
 * A GitHub Actions `::warning::` when the database reports posts missing from the list or deleted:
 * a post missing for 30 days is deleted together with its votes, so a bug that drops slugs from
 * the list must be noticed before then. Undefined when nothing is missing or deleted. The sync
 * still succeeds (exit 0).
 */
export function missingWarning(result) {
  const missing = countOf(result?.missing)
  const deleted = countOf(result?.deleted)
  if (missing === 0 && deleted === 0) return undefined
  return (
    `::warning::sync-blog-posts: ${missing} post(s) missing from this deploy's list and ${deleted} deleted. ` +
    `A post missing for 30 days is deleted together with its Helpful votes. List them with: ${MISSING_POSTS_SQL}`
  )
}

/**
 * The CLI. `argv` without node and the script path; `env` the process environment; `io` where it
 * prints. Answers the exit code instead of exiting, so tests can call it.
 *
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @param {{ log: (message: string) => void, error: (message: string) => void }} [io]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error }, fetchImpl = fetch) {
  const dryRun = argv.includes('--dry-run')
  const fileIndex = argv.indexOf('--env-file')
  const envFile = fileIndex >= 0 ? argv[fileIndex + 1] : undefined
  if (fileIndex >= 0 && !envFile) {
    io.error('sync-blog-posts: --env-file needs a path')
    return 1
  }

  const slugs = blogSlugs()
  if (dryRun) {
    io.log(`sync-blog-posts: ${slugs.length} post(s) would be sent:`)
    for (const slug of slugs) io.log(`  ${slug}`)
    return 0
  }

  let fileVars = {}
  if (envFile) {
    const file = path.resolve(envFile)
    if (!fs.existsSync(file)) {
      io.error(`sync-blog-posts: env file not found: ${envFile}`)
      return 1
    }
    fileVars = parseEnvFile(fs.readFileSync(file, 'utf8'))
  }
  const config = readConfig({ ...fileVars, ...env })
  if (config.missing.length) {
    io.error(`sync-blog-posts: missing ${config.missing.join(', ')}`)
    return 1
  }

  const secrets = [config.token, config.key]
  try {
    const result = await syncBlogPosts({ ...config, slugs, fetchImpl })
    io.log(`sync-blog-posts: ${slugs.length} post(s) sent to ${new URL(config.url).host}`)
    for (const name of ['added', 'missing', 'deleted']) io.log(`  ${redact(describe(name, result[name]), secrets)}`)
    const warning = missingWarning(result)
    if (warning) io.log(warning)
    return 0
  } catch (err) {
    io.error(`sync-blog-posts: ${redact(err instanceof Error ? err.message : err, secrets)}`)
    return 1
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code
  })
}
