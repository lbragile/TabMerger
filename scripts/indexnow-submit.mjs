#!/usr/bin/env node
// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver) to recrawl every page in the live
// sitemap. Bing's index feeds ChatGPT search, so run this after a production web deploy that
// changes public pages (copy, prices, features).
//
//   node scripts/indexnow-submit.mjs                        # https://tabmerger.com
//   node scripts/indexnow-submit.mjs --origin https://x.com # another production host
//   node scripts/indexnow-submit.mjs --dry-run              # print what would be sent
//
// The key is read from the live site's key file (packages/web/lib/indexNow.ts serves it), so the
// site and this script can never disagree about it, and a submission only works once the deploy
// carrying the key file is live. Plain Node, no dependencies, like the other root scripts.

import { pathToFileURL } from 'node:url'

export const DEFAULT_ORIGIN = 'https://tabmerger.com'
export const KEY_PATH = '/indexnow.txt'
export const ENDPOINT = 'https://api.indexnow.org/indexnow'
/** IndexNow's per-request URL limit. */
export const MAX_URLS = 10_000

/** `--origin <url>` and `--dry-run`; anything else is an error, so a typo never submits. */
export function parseArgs(argv) {
  const options = { origin: DEFAULT_ORIGIN, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--origin' && i + 1 < argv.length) options.origin = argv[++i]
    else if (arg.startsWith('--origin=')) options.origin = arg.slice('--origin='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

/** An https origin with no path, query or credentials, e.g. `https://tabmerger.com`. */
export function parseOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Not a URL: ${value}`)
  }
  if (url.protocol !== 'https:') throw new Error(`The origin must be https: ${value}`)
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`Give the origin only (no path, query or credentials): ${value}`)
  }
  return url
}

/** IndexNow keys are 8-128 characters of a-z, A-Z, 0-9 and dashes. */
export function isValidKey(key) {
  return /^[a-zA-Z0-9-]{8,128}$/.test(key)
}

/**
 * The page URLs in a sitemap: every `<loc>`, unescaped, deduplicated, and only https URLs on
 * `host` (IndexNow rejects a request whose URLs are on another host).
 */
export function extractSitemapUrls(xml, host) {
  const urls = new Set()
  for (const [, raw] of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const text = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    let url
    try {
      url = new URL(text)
    } catch {
      continue
    }
    if (url.protocol === 'https:' && url.host === host) urls.add(url.href)
  }
  return [...urls]
}

/** The JSON body IndexNow takes. */
export function buildPayload(origin, key, urls) {
  return { host: origin.host, key, keyLocation: new URL(KEY_PATH, origin).href, urlList: urls.slice(0, MAX_URLS) }
}

/** What an IndexNow response status means, from indexnow.org/documentation. */
export function describeStatus(status) {
  switch (status) {
    case 200:
      return 'accepted'
    case 202:
      return 'accepted; the key is still being validated'
    case 400:
      return 'bad request (invalid format)'
    case 403:
      return 'forbidden: the key file was not found or does not match the key'
    case 422:
      return 'unprocessable: a URL is not on the host, or the key does not match the protocol'
    case 429:
      return 'too many requests: wait before submitting again'
    default:
      return `unexpected status ${status}`
  }
}

async function fetchText(fetchImpl, url) {
  const res = await fetchImpl(url, { redirect: 'error' })
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`)
  return res.text()
}

/** Reads the key and sitemap from the live site and submits them. Returns a process exit code. */
export async function run(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const { origin: originArg, dryRun } = parseArgs(argv)
  const origin = parseOrigin(originArg)

  const key = (await fetchText(fetchImpl, new URL(KEY_PATH, origin).href)).trim()
  if (!isValidKey(key)) throw new Error(`${KEY_PATH} on ${origin.host} does not hold a valid IndexNow key (deployed yet?)`)

  const urls = extractSitemapUrls(await fetchText(fetchImpl, new URL('/sitemap.xml', origin).href), origin.host)
  if (urls.length === 0) throw new Error(`The sitemap on ${origin.host} lists no https URLs on that host`)

  const payload = buildPayload(origin, key, urls)
  log(`${payload.urlList.length} URL(s) on ${origin.host}${urls.length > MAX_URLS ? ` (first ${MAX_URLS} of ${urls.length})` : ''}`)
  if (dryRun) {
    log(JSON.stringify(payload, null, 2))
    return 0
  }

  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  log(`IndexNow: ${res.status} ${describeStatus(res.status)}`)
  return res.status === 200 || res.status === 202 ? 0 : 1
}

// `process.exitCode`, not `process.exit()`: exiting while fetch is still closing its socket trips a
// libuv assertion on Windows (UV_HANDLE_CLOSING) and replaces the exit code with a crash.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(`indexnow-submit: ${error.message}`)
      process.exitCode = 1
    }
  )
}
