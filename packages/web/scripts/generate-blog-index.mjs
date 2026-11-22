/**
 * Lists the blog's MDX files in a TypeScript module, `generated/blog.ts`, that `lib/blog/posts.ts`
 * imports: one entry per post folder (`content/blog/<slug>/`) and per locale file in it
 * (`<locale>.mdx`), with a static `import()` of the file and its readable word count (for the read
 * time). So adding `content/blog/<slug>/es.mdx` publishes the Spanish post (static params, sitemap,
 * hreflang) with no code change, and nothing reads the filesystem at runtime.
 *
 * Runs from next.config.ts (every `next dev` / `next build`), from Vitest's global setup, and
 * before `tsc` in the `type-check` script, like scripts/generate-changelog.mjs. The output is
 * git-ignored (`packages/web/generated/`).
 *
 * `scanBlogContent` is also the slug list scripts/sync-blog-posts.mjs registers in the database
 * (`blog_posts`, for Helpful votes) after each deploy, so a new post needs no migration.
 *
 *   node scripts/generate-blog-index.mjs
 *
 * Plain JavaScript with Node built-ins only, so next.config.ts, Vitest and the CLI can all load it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Where posts live: one folder per slug. */
export const BLOG_CONTENT_DIR = path.resolve(WEB_ROOT, 'content', 'blog')

/** The generated module (git-ignored). */
export const BLOG_INDEX_MODULE = path.resolve(WEB_ROOT, 'generated', 'blog.ts')

/** Where a cover's `/blog/...` paths live. */
export const PUBLIC_DIR = path.resolve(WEB_ROOT, 'public')

/** A post folder name: the URL slug (same rule as the `blog_posts.slug` check in the database). */
export const BLOG_SLUG_PATTERN = /^[a-z0-9-]{1,80}$/

/** A post file name: a locale code such as `en`, `pt-BR` or `zh-CN`, then `.mdx`. */
/** Where scanBlogContent keeps a post's boxes.json (not one of its locales). */
const BOXES = Symbol('boxes')

const LOCALE_FILE_PATTERN = /^([a-z]{2}(?:-[A-Z]{2})?)\.mdx$/

/** Browser panels a reader doesn't see by default (the switcher starts on Chrome). */
const HIDDEN_PANEL_PATTERN = /<BrowserPanel\s+browser="(?!chrome")[^"]*"[^>]*>[\s\S]*?<\/BrowserPanel>/g

/** Reading rates behind the read time: words of spaced scripts, and CJK characters, per minute. */
export const WORDS_PER_MINUTE = 230
export const CJK_CHARS_PER_MINUTE = 500

/** Han, Hiragana and Katakana characters: Chinese and Japanese text has no spaces between words. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu

/**
 * The words a reader reads in a post's MDX source: the body without the `export const post`
 * block, comments, JSX tags (and their props) or the panels for browsers other than Chrome. A
 * word is any run of non-space characters containing a letter or digit. Chinese and Japanese
 * characters are counted one by one and converted to equivalent words (500 characters a minute
 * against 230 words), so their read time matches the English one; Korean is spaced and counted as
 * words. Deterministic: the same source always gives the same number.
 */
export function countReadableWords(source) {
  const body = source
    .replace(/^export const [\s\S]*?^}\s*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(HIDDEN_PANEL_PATTERN, ' ')
    .replace(/<[^>]*>/g, ' ')
  const cjkChars = (body.match(CJK) ?? []).length
  const spacedWords = body
    .replace(CJK, ' ')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length
  return spacedWords + Math.round((cjkChars * WORDS_PER_MINUTE) / CJK_CHARS_PER_MINUTE)
}

/** The `export const post = {…}` block of a post file ('' when there is none). */
function postBlock(source) {
  const match = /^export const post = \{[\s\S]*?^\}\s*$/m.exec(source)
  return match ? match[0] : ''
}

/**
 * The value of a JavaScript string literal's body, escapes resolved the way JavaScript does
 * (`‏`, `\u{1F600}`, `\x41`, `\n`, `\'`), so the index holds exactly the string the post
 * exports. Direction marks (U+200E, U+200F, U+061C) written as characters pass through untouched.
 */
export function unescapeJsString(body) {
  const named = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, esc) => {
    if (esc.startsWith('u{')) return String.fromCodePoint(parseInt(esc.slice(2, -1), 16))
    if (esc.length === 5 && esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16))
    if (esc.length === 3 && esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16))
    if (esc === '\n' || esc === '\r\n' || esc === '\r') return '' // line continuation
    return named[esc] ?? esc
  })
}

/** A top-level `key: '…'` string in the post block (single-quoted literal), or undefined. */
function stringField(block, key) {
  const match = new RegExp(`\\b${key}:\\s*'((?:[^'\\\\]|\\\\[\\s\\S])*)'`).exec(block)
  return match ? unescapeJsString(match[1]) : undefined
}

/** The `src` of every entry in the post block's `images: [ … ]` list, in order. */
function imageSources(block) {
  const start = block.search(/\bimages:\s*\[/)
  if (start < 0) return []
  let depth = 0
  let end = start
  for (let i = block.indexOf('[', start); i < block.length; i++) {
    if (block[i] === '[') depth++
    else if (block[i] === ']' && --depth === 0) {
      end = i
      break
    }
  }
  return [...block.slice(start, end).matchAll(/\bsrc:\s*'([^']+)'/g)].map((m) => m[1])
}

/** The body of a top-level `key: { … }` object in the post block (braces balanced), or ''. */
function objectField(block, key) {
  const start = block.search(new RegExp(`\\b${key}:\\s*\\{`))
  if (start < 0) return ''
  let depth = 0
  for (let i = block.indexOf('{', start); i < block.length; i++) {
    if (block[i] === '{') depth++
    else if (block[i] === '}' && --depth === 0) return block.slice(block.indexOf('{', start) + 1, i)
  }
  return ''
}

/**
 * The optional `cover` of a post, as written (checked by `resolveCover`): `{ src, srcDark?, alt?: '' }`.
 * Covers are shown whole (no crop, no zoom), so they carry no focus or zoom.
 */
export function readCover(block) {
  const body = objectField(block, 'cover')
  if (!body) return undefined
  const extra = [...body.matchAll(/\b([A-Za-z]+):/g)].map((m) => m[1]).filter((key) => !['src', 'srcDark', 'alt'].includes(key))
  return { src: stringField(body, 'src'), srcDark: stringField(body, 'srcDark'), extra }
}

/** Card images are 4:3 (every TabMerger capture is 1600×1200); a cover may be off by at most 2%. */
export const COVER_RATIO = 4 / 3
export const COVER_RATIO_TOLERANCE = 0.02
const IMAGE_PATH = /^\/blog\/[a-z0-9-]+\/[a-z0-9/-]+\.(webp|png|jpg)$/

/** Whether a width and height are within 2% of 4:3. */
export function isCoverRatio(width, height) {
  return width > 0 && height > 0 && Math.abs(width / height / COVER_RATIO - 1) <= COVER_RATIO_TOLERANCE
}

/** An image file's pixel size from its header (WebP, PNG or JPEG), or undefined. */
export function imageSize(file) {
  const b = fs.readFileSync(file)
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return undefined
}

/** The `-dark` partner of a `-light` capture, when that file exists. */
function darkSibling(src, exists) {
  const dark = src.replace(/-light(\.[a-z]+)$/, '-dark$1')
  return dark !== src && exists(dark) ? dark : undefined
}

/**
 * What the blog index card shows for a post, shown whole in a 4:3 frame: its `cover` (checked:
 * files under public/, each within 2% of 4:3), else the first `images` entry that is 4:3, else
 * nothing (the card shows the TabMerger mark). A `-light` image with a `-dark` file beside it gets
 * that as its dark-theme version, like the post's ThemedScreenshot pairs. A wide browser strip is
 * never used. Throws on a bad cover, failing the build.
 */
export function resolveCover(where, { cover, images }, publicDir = PUBLIC_DIR) {
  const file = (src) => path.join(publicDir, ...src.split('/').filter(Boolean))
  const exists = (src) => fs.existsSync(file(src))
  const isFourThree = (src) => {
    const size = imageSize(file(src))
    return Boolean(size) && isCoverRatio(size.width, size.height)
  }
  if (!cover) {
    const src = images.find((image) => IMAGE_PATH.test(image) && exists(image) && isFourThree(image))
    if (!src) return undefined
    const srcDark = darkSibling(src, exists)
    return { src, ...(srcDark && isFourThree(srcDark) ? { srcDark } : {}) }
  }
  const fail = (message) => {
    throw new Error(`generate-blog-index: ${where} cover ${message}`)
  }
  if (cover.extra?.length) fail(`has unknown field(s) ${cover.extra.join(', ')}: a cover is { src, srcDark?, alt?: '' }, shown whole`)
  for (const field of ['src', 'srcDark']) {
    const src = cover[field]
    if (src === undefined && field === 'srcDark') continue
    if (typeof src !== 'string' || !IMAGE_PATH.test(src)) fail(`${field} must be a /blog/<slug>/<name>.webp|png|jpg path`)
    if (!exists(src)) fail(`${field} "${src}" is not a file under public/`)
    const size = imageSize(file(src))
    if (!size) fail(`${field} "${src}" has no readable image size`)
    if (!isCoverRatio(size.width, size.height)) {
      fail(`${field} "${src}" is ${size.width}×${size.height}; covers are 4:3 (within 2%), e.g. a 1600×1200 TabMerger capture`)
    }
  }
  const srcDark = cover.srcDark ?? darkSibling(cover.src, exists)
  return { src: cover.src, ...(srcDark && isFourThree(srcDark) ? { srcDark } : {}) }
}

/**
 * The few `post` fields that sync code needs without loading the MDX (the sitemap's image list,
 * llms.txt's title and summary), read from the source text. lib/blog/posts.ts parses the real
 * export; a unit test checks the two agree.
 */
export function readPostSummary(source) {
  const block = postBlock(source)
  const tagList = /\btags:\s*\[([^\]]*)\]/.exec(block)
  const tags = tagList ? [...tagList[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
  return {
    title: stringField(block, 'title') ?? '',
    description: stringField(block, 'description') ?? '',
    shareSummary: stringField(block, 'shareSummary') ?? '',
    navTitle: stringField(block, 'navTitle'),
    published: stringField(block, 'published') ?? '',
    images: imageSources(block),
    tags,
    cover: readCover(block),
  }
}

/**
 * A post's annotation boxes, recorded from the live screens by the capture scripts:
 * `content/blog/<slug>/boxes.json`, `{ "<image stem>": [{ id, label, l, t, w, h }] }` in reading
 * order (percent of the image). Missing file: `{}` (figures fall back to their own boxes).
 */
export function readBoxes(dir, slug) {
  const file = path.join(dir, slug, 'boxes.json')
  if (!fs.existsSync(file)) return {}
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Percent values may be numbers (4.84) or CSS strings ("4.84%").
  const pct = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?%?$/.test(v.trim()) ? parseFloat(v) : NaN)
  const out = {}
  for (const [stem, boxes] of Object.entries(data)) {
    if (!Array.isArray(boxes)) throw new Error(`generate-blog-index: content/blog/${slug}/boxes.json "${stem}" is not a list`)
    out[stem] = boxes.map((b) => {
      const box = { id: b && b.id, l: pct(b && b.l), t: pct(b && b.t), w: pct(b && b.w), h: pct(b && b.h) }
      if (typeof box.id !== 'string' || ['l', 't', 'w', 'h'].some((k) => !Number.isFinite(box[k]))) {
        throw new Error(`generate-blog-index: content/blog/${slug}/boxes.json "${stem}" has a box without an id or a number for l, t, w, h`)
      }
      // `label` is the capture script's description, kept for humans reading the file, not readers.
      return box
    })
  }
  return out
}

/** `{ slug: { locale: { file, words, title, description, images } } }` for every post file. */
/** The folder of dev-only placeholder posts (`content/blog/_placeholders/<slug>/en.mdx`). */
export const PLACEHOLDERS_DIR = '_placeholders'

/**
 * Placeholder entries (flagged `placeholder: true`) are in the generated module in every mode but
 * a production build (`next build`, the Vercel build: NODE_ENV "production"), where they are left
 * out entirely, so no import of them is bundled. `next dev`, Vitest and `type-check` all write the
 * same file, so they never undo each other; whether placeholders show is decided at runtime
 * (`placeholdersEnabled` in lib/blog/posts.ts: `next dev` only, off with BLOG_DEV_PLACEHOLDERS=0).
 */
export function includePlaceholders(env = process.env) {
  return env.NODE_ENV !== 'production'
}

/**
 * @param {string} [dir]
 * @param {{ placeholders?: boolean, publicDir?: string }} [options]
 * @returns {Record<string, Record<string, any>>}
 */
export function scanBlogContent(dir = BLOG_CONTENT_DIR, { placeholders = includePlaceholders(), publicDir = PUBLIC_DIR } = {}) {
  /** @type {Record<string, Record<string, any>>} */
  const posts = {}
  if (!fs.existsSync(dir)) return posts
  if (placeholders && fs.existsSync(path.join(dir, PLACEHOLDERS_DIR))) {
    for (const [slug, locales] of Object.entries(scanBlogContent(path.join(dir, PLACEHOLDERS_DIR), { placeholders: false, publicDir }))) {
      for (const entry of Object.values(locales)) {
        entry.placeholder = true
        entry.file = `${PLACEHOLDERS_DIR}/${slug}/${entry.file}`
      }
      posts[slug] = locales
    }
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === PLACEHOLDERS_DIR) continue
    if (!BLOG_SLUG_PATTERN.test(entry.name)) {
      throw new Error(`generate-blog-index: "${entry.name}" is not a valid post slug (${BLOG_SLUG_PATTERN})`)
    }
    const locales = {}
    for (const file of fs.readdirSync(path.join(dir, entry.name)).sort()) {
      const match = LOCALE_FILE_PATTERN.exec(file)
      if (!match) continue
      const source = fs.readFileSync(path.join(dir, entry.name, file), 'utf8')
      locales[match[1]] = { file, words: countReadableWords(source), ...readPostSummary(source) }
    }
    if (!locales.en) {
      throw new Error(`generate-blog-index: content/blog/${entry.name}/ has no en.mdx (English is written first)`)
    }
    // A translation without its own cover uses the English one.
    const englishCover = locales.en.cover
    for (const summary of Object.values(locales)) {
      summary.cover = resolveCover(`content/blog/${entry.name}/${summary.file}`, { cover: summary.cover ?? englishCover, images: summary.images }, publicDir)
    }
    Object.defineProperty(locales, BOXES, { value: readBoxes(dir, entry.name), enumerable: false })
    if (posts[entry.name]) throw new Error(`generate-blog-index: "${entry.name}" is both a post and a placeholder`)
    posts[entry.name] = locales
  }
  return posts
}

/** The generated module's source for a scan result. */
export function renderBlogIndexModule(posts) {
  const lines = [
    '// Generated by scripts/generate-blog-index.mjs from content/blog/. Do not edit.',
    '',
    'export interface BlogSource {',
    '  /** Readable words in the file (scripts/generate-blog-index.mjs `countReadableWords`). */',
    '  words: number',
    '  /** `post.title`, `post.description` and the `post.images` sources, read from the source text. */',
    '  title: string',
    '  description: string',
    '  /** `post.published` (YYYY-MM-DD): the go-live date. */',
    '  published: string',
    '  images: readonly string[]',
    '  tags: readonly string[]',
    '  /** A shorter title for the previous/next links (`post.navTitle`), if the post has one. */',
    '  navTitle?: string',
    '  /** The index card image, shown whole at 4:3: `post.cover`, else the first 4:3 `images` entry (`resolveCover`). */',
    '  cover?: { src: string; srcDark?: string }',
    '  /** A dev-only placeholder (content/blog/_placeholders): `next dev` only, never indexed or listed. */',
    '  placeholder?: boolean',
    '  load: () => Promise<unknown>',
    '}',
    '',
    '/** Every post folder and the locale files in it. */',
    'export const BLOG_SOURCES: Record<string, Record<string, BlogSource>> = {',
  ]
  for (const [slug, locales] of Object.entries(posts)) {
    lines.push(`  ${JSON.stringify(slug)}: {`)
    for (const [locale, { file, words, title, description, published, images, tags, navTitle, cover, placeholder }] of Object.entries(locales)) {
      lines.push(
        `    ${JSON.stringify(locale)}: {`,
        `      words: ${words},`,
        `      title: ${JSON.stringify(title)},`,
        `      description: ${JSON.stringify(description)},`,
        `      published: ${JSON.stringify(published)},`,
        `      images: ${JSON.stringify(images)},`,
        `      tags: ${JSON.stringify(tags)},`,
        ...(navTitle ? [`      navTitle: ${JSON.stringify(navTitle)},`] : []),
        ...(cover ? [`      cover: ${JSON.stringify(cover)},`] : []),
        ...(placeholder ? ['      placeholder: true,'] : []),
        `      load: () => import(${JSON.stringify(`@/content/blog/${file.includes('/') ? file : `${slug}/${file}`}`)}),`,
        '    },'
      )
    }
    lines.push('  },')
  }
  lines.push('}', '')
  const boxes = Object.fromEntries(Object.entries(posts).map(([slug, locales]) => [slug, locales[BOXES] ?? {}]))
  lines.push(
    '/** Annotation boxes per post and image stem (content/blog/<slug>/boxes.json), in reading order. */',
    'export const BLOG_BOXES: Record<string, Record<string, readonly { id: string; l: number; t: number; w: number; h: number }[]>> = ' +
      JSON.stringify(boxes),
    ''
  )
  return lines.join('\n')
}

/** Writes the module, only when its content changed (so `next dev` doesn't recompile on start). */
export function generateBlogIndexModule({ dir = BLOG_CONTENT_DIR, out = BLOG_INDEX_MODULE } = {}) {
  const next = renderBlogIndexModule(scanBlogContent(dir))
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : undefined
  if (current === next) return false
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, next)
  return true
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    generateBlogIndexModule()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
