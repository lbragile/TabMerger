// Run with: node --test scripts/indexnow-submit.test.mjs
// Plain node:test, like the other root scripts: the network is a fake `fetch`, so nothing is sent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ORIGIN,
  ENDPOINT,
  MAX_URLS,
  buildPayload,
  describeStatus,
  extractSitemapUrls,
  isValidKey,
  parseArgs,
  parseOrigin,
  run,
} from './indexnow-submit.mjs'

const KEY = '8d52356bc0e253ad07ef1a2b738f0662'
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.test/</loc></url>
<url><loc>https://example.test/pricing</loc></url>
<url><loc> https://example.test/faq </loc></url>
<url><loc>https://example.test/pricing</loc></url>
</urlset>`

/** A fake fetch serving the key file and sitemap, recording every request. */
function fakeFetch({ key = KEY, sitemap = SITEMAP, postStatus = 200 } = {}) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url === 'https://example.test/indexnow.txt') return new Response(key)
    if (url === 'https://example.test/sitemap.xml') return new Response(sitemap)
    if (url === ENDPOINT) return new Response(null, { status: postStatus })
    return new Response('not found', { status: 404 })
  }
  return { impl, calls }
}

test('parseArgs defaults to the production origin and rejects unknown flags', () => {
  assert.deepEqual(parseArgs([]), { origin: DEFAULT_ORIGIN, dryRun: false })
  assert.deepEqual(parseArgs(['--origin', 'https://a.test', '--dry-run']), { origin: 'https://a.test', dryRun: true })
  assert.deepEqual(parseArgs(['--origin=https://b.test']), { origin: 'https://b.test', dryRun: false })
  assert.throws(() => parseArgs(['--orgin', 'https://a.test']), /Unknown argument/)
  assert.throws(() => parseArgs(['--origin']), /Unknown argument/)
})

test('parseOrigin accepts a bare https origin only', () => {
  assert.equal(parseOrigin('https://example.test').host, 'example.test')
  assert.equal(parseOrigin('https://example.test/').host, 'example.test')
  assert.throws(() => parseOrigin('http://example.test'), /https/)
  assert.throws(() => parseOrigin('https://example.test/pricing'), /origin only/)
  assert.throws(() => parseOrigin('https://example.test/?a=1'), /origin only/)
  const withCredentials = new URL('https://example.test')
  withCredentials.username = 'user'
  withCredentials.password = 'pw'
  assert.throws(() => parseOrigin(withCredentials.href), /origin only/)
  assert.throws(() => parseOrigin('not a url'), /Not a URL/)
})

test('isValidKey follows the IndexNow key format', () => {
  assert.equal(isValidKey(KEY), true)
  assert.equal(isValidKey('short'), false)
  assert.equal(isValidKey('has space in it'), false)
  assert.equal(isValidKey('<html>not a key</html>'), false)
  assert.equal(isValidKey('a'.repeat(129)), false)
})

test('extractSitemapUrls dedupes, trims, unescapes, and keeps only https URLs on the host', () => {
  const xml = `${SITEMAP}
<url><loc>https://other.test/</loc></url>
<url><loc>http://example.test/insecure</loc></url>
<url><loc>https://example.test/search?a=1&amp;b=2</loc></url>
<url><loc>not a url</loc></url>`
  assert.deepEqual(extractSitemapUrls(xml, 'example.test'), [
    'https://example.test/',
    'https://example.test/pricing',
    'https://example.test/faq',
    'https://example.test/search?a=1&b=2',
  ])
})

test('buildPayload names the key file on the same host and caps the URL list', () => {
  const origin = parseOrigin('https://example.test')
  const many = Array.from({ length: MAX_URLS + 5 }, (_, i) => `https://example.test/${i}`)
  const payload = buildPayload(origin, KEY, many)
  assert.equal(payload.host, 'example.test')
  assert.equal(payload.key, KEY)
  assert.equal(payload.keyLocation, 'https://example.test/indexnow.txt')
  assert.equal(payload.urlList.length, MAX_URLS)
})

test('describeStatus explains the documented IndexNow statuses', () => {
  assert.equal(describeStatus(200), 'accepted')
  assert.match(describeStatus(202), /accepted/)
  assert.match(describeStatus(403), /key file/)
  assert.match(describeStatus(422), /host/)
  assert.match(describeStatus(429), /wait/)
  assert.match(describeStatus(500), /unexpected status 500/)
})

test('run submits the live key and sitemap URLs once, and exits 0 when accepted', async () => {
  const { impl, calls } = fakeFetch()
  const code = await run(['--origin', 'https://example.test'], { fetchImpl: impl, log: () => {} })
  assert.equal(code, 0)
  const posts = calls.filter((c) => c.url === ENDPOINT)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(posts[0].init.body), {
    host: 'example.test',
    key: KEY,
    keyLocation: 'https://example.test/indexnow.txt',
    urlList: ['https://example.test/', 'https://example.test/pricing', 'https://example.test/faq'],
  })
})

test('run --dry-run sends nothing to IndexNow', async () => {
  const { impl, calls } = fakeFetch()
  const lines = []
  const code = await run(['--origin', 'https://example.test', '--dry-run'], { fetchImpl: impl, log: (l) => lines.push(l) })
  assert.equal(code, 0)
  assert.equal(calls.some((c) => c.url === ENDPOINT), false)
  assert.match(lines.join('\n'), /"keyLocation": "https:\/\/example.test\/indexnow.txt"/)
})

test('run exits 1 when IndexNow refuses the submission', async () => {
  const { impl } = fakeFetch({ postStatus: 403 })
  assert.equal(await run(['--origin', 'https://example.test'], { fetchImpl: impl, log: () => {} }), 1)
})

test('run refuses to submit when the key file is not deployed or the sitemap has no URLs on the host', async () => {
  await assert.rejects(
    run(['--origin', 'https://example.test'], { fetchImpl: fakeFetch({ key: '<!doctype html>' }).impl, log: () => {} }),
    /valid IndexNow key/
  )
  await assert.rejects(
    run(['--origin', 'https://example.test'], { fetchImpl: fakeFetch({ sitemap: '<urlset><url><loc>https://other.test/</loc></url></urlset>' }).impl, log: () => {} }),
    /no https URLs/
  )
  await assert.rejects(run(['--origin', 'https://missing.test'], { fetchImpl: fakeFetch().impl, log: () => {} }), /returned 404/)
})
