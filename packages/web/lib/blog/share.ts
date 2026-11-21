/**
 * Share links for a post, each composer prefilled with text written for that platform from the
 * same pieces: the title, the description or one-line summary, the post's link, and where to get
 * TabMerger (one short `/download` link that picks the reader's store, the web app, the source).
 * Nothing loads from the platforms until the reader clicks (plain links, no third-party script).
 * The post URL is its absolute canonical URL (no tracking parameters) and every value is
 * `encodeURIComponent`-ed.
 *
 * - LinkedIn, WhatsApp, Telegram (no title field): title, description, link, the TabMerger lines
 *   with emoji markers; hashtags on LinkedIn only; WhatsApp bolds the title; Telegram takes the link
 *   as its own `url` parameter.
 * - Reddit: a link post (`type=LINK`): the post URL is the embed (its preview card), the title has
 *   its own field, and the optional body is plain text that repeats neither (no emoji or hashtags).
 * - Email: subject = title; plain body without the title, emoji or hashtags. The system share sheet
 *   gets the same body.
 * - X, Bluesky, Threads: title, summary, the link, then hashtags, within each limit (X counts
 *   every link as 23); Threads adds the download link when it fits.
 *
 * Preview cards: each platform builds its card from one link, so that link is always the post: the
 * first URL in the text (X, LinkedIn, WhatsApp, Threads, Bluesky) or the `url`/`u` parameter
 * (Telegram, Reddit, Facebook). The download, web app and GitHub links always come after it.
 *
 * Three platforms can't be relied on to keep the text (`COPY_FIRST`): Facebook's sharer takes only
 * the URL (by policy), LinkedIn's `feed/?shareActive=true&text=` and the body of Reddit's link
 * posts are undocumented and sometimes dropped. For those the Share menu also copies the text to
 * the clipboard before opening the composer, so the reader can paste it.
 */

/** The platforms the Share menu offers, in menu order (after "Share…" and "Copy link"). */
export const SHARE_PLATFORMS = ['x', 'linkedIn', 'facebook', 'reddit', 'bluesky', 'threads', 'whatsApp', 'telegram', 'email'] as const

export type SharePlatform = (typeof SHARE_PLATFORMS)[number]

/** Platforms whose prefilled text isn't guaranteed: the text is also copied on click. */
export const COPY_FIRST: ReadonlySet<SharePlatform> = new Set<SharePlatform>(['linkedIn', 'reddit', 'facebook'])

/** Platforms with their own title field: their text never repeats the title. */
export const HAS_TITLE_FIELD: ReadonlySet<SharePlatform> = new Set<SharePlatform>(['reddit', 'email'])

/** Each platform's own name (the same in every language), for "paste it into <Platform>". */
export const PLATFORM_NAME: Record<SharePlatform, string> = {
  x: 'X',
  linkedIn: 'LinkedIn',
  facebook: 'Facebook',
  reddit: 'Reddit',
  bluesky: 'Bluesky',
  threads: 'Threads',
  whatsApp: 'WhatsApp',
  telegram: 'Telegram',
  email: 'Email',
}

/** X counts every link as 23 characters and allows 280 in all. */
export const X_LIMIT = 280
export const X_URL_LENGTH = 23
/** Bluesky: 300 graphemes per post. Threads: 500 characters. LinkedIn: 3,000. */
export const BLUESKY_LIMIT = 300
export const THREADS_LIMIT = 500
export const LINKEDIN_LIMIT = 3000

export interface ShareContent {
  /** The post's absolute canonical URL. */
  url: string
  title: string
  description: string
  /** One line (≤100 characters) for the short platforms. */
  summary: string
  /** Hashtag words (no "#", no spaces), the post's first tags in the page's language. */
  hashtags: readonly string[]
  /** The site's origin ("https://tabmerger.com"), the web app link. */
  origin: string
  /** `<origin>/download`: one link that sends each browser to its store. */
  downloadUrl: string
  githubUrl: string
}

/** The translated lines (blog.interactive messages, already filled in; no emoji in them). */
export interface ShareStrings {
  /** "Read the guide: <post url>" */
  readGuide: string
  /** "TabMerger is a free, open-source tab manager:" */
  about: string
  /** "Download: <origin>/download" */
  download: string
  /** "Web app: <origin>" */
  webApp: string
  /** "GitHub: <repo>" */
  github: string
  /** "TabMerger (free, open source): <download> · GitHub: <repo>" (Reddit's one plain line). */
  redditFooter: string
}

/** Characters as people see them (an emoji or an accented letter is one). */
export function graphemeCount(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
  }
  return [...text].length
}

/** X's length: every link counts as 23, whatever its real length. */
export function xLength(text: string): number {
  return graphemeCount(text.replace(/https?:\/\/\S+/g, 'x'.repeat(X_URL_LENGTH)))
}

/** "save-tabs" → "SaveTabs": a hashtag can't contain spaces or hyphens. */
export function hashtagWord(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join('')
}

const hashtags = (content: ShareContent, count: number) =>
  content.hashtags
    .slice(0, count)
    .map((h) => `#${h}`)
    .join(' ')

/** The TabMerger block with emoji markers (LinkedIn, WhatsApp, Telegram). */
const tabMergerLines = (strings: ShareStrings) => [strings.about, `⬇️ ${strings.download}`, `🌐 ${strings.webApp}`, `💻 ${strings.github}`]

/** The long text for platforms without a title field: LinkedIn, WhatsApp, Telegram. */
function richText(
  content: ShareContent,
  strings: ShareStrings,
  { boldTitle = false, link = true, tags = 0 }: { boldTitle?: boolean; link?: boolean; tags?: number } = {}
): string {
  return [
    boldTitle ? `*${content.title}*` : content.title,
    '',
    content.description,
    ...(link ? ['', `📖 ${strings.readGuide}`] : []),
    '',
    ...tabMergerLines(strings),
    ...(tags > 0 && content.hashtags.length > 0 ? ['', hashtags(content, tags)] : []),
  ].join('\n')
}

/** The plain body for email and the system share sheet: no title (it's the subject), no emoji. */
export function emailBody(content: ShareContent, strings: ShareStrings): string {
  return [content.description, '', strings.readGuide, '', strings.about, strings.download, strings.webApp, strings.github].join('\n')
}

/** Reddit's body: the title and the link have their own fields, so neither is repeated; plain text. */
export function redditBody(content: ShareContent, strings: ShareStrings): string {
  return [content.description, '', strings.redditFooter].join('\n')
}

/** The first candidate that fits; the last one otherwise. */
function firstThatFits(candidates: readonly string[], fits: (text: string) => boolean): string {
  return candidates.find(fits) ?? candidates[candidates.length - 1]
}

/** Cuts `text` to `max` characters with an ellipsis (only when nothing shorter fits). */
function cut(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…` : text
}

/** "<title>\n<summary>\n<url>" plus `extra` lines: the short platforms' shape. */
function shortCandidates(content: ShareContent, maxTags: number, extra: readonly string[] = []): string[] {
  const head = [content.title, content.summary, content.url]
  const out: string[] = []
  for (let n = maxTags; n >= 0; n--) {
    const tags = n > 0 ? [hashtags(content, n)] : []
    if (extra.length) out.push([...head, ...extra, ...tags].join('\n'))
    out.push([...head, ...tags].join('\n'))
  }
  out.push([content.title, content.url].join('\n'))
  return out
}

/** X: title, summary, the post link (in the text, so it shows once), 1–2 hashtags; ≤280. */
export function xText(content: ShareContent): string {
  const fits = (text: string) => xLength(text) <= X_LIMIT
  return firstThatFits([...shortCandidates(content, 2), [cut(content.title, X_LIMIT - X_URL_LENGTH - 1), content.url].join('\n')], fits)
}

/** Bluesky: title, summary, the post link, up to 3 hashtags; ≤300 graphemes. */
export function blueskyText(content: ShareContent): string {
  const fits = (text: string) => graphemeCount(text) <= BLUESKY_LIMIT
  return firstThatFits(
    [...shortCandidates(content, 3), [cut(content.title, BLUESKY_LIMIT - graphemeCount(content.url) - 1), content.url].join('\n')],
    fits
  )
}

/** Threads: like Bluesky, plus "⬇️ <download link>" when it fits; ≤500 characters. */
export function threadsText(content: ShareContent): string {
  const fits = (text: string) => [...text].length <= THREADS_LIMIT
  return firstThatFits(
    [
      ...shortCandidates(content, 3, [`⬇️ ${content.downloadUrl}`]),
      [cut(content.title, THREADS_LIMIT - [...content.url].length - 1), content.url].join('\n'),
    ],
    fits
  )
}

/** What each platform's composer is prefilled with (and what the copy-first ones copy). */
export function shareText(platform: SharePlatform, content: ShareContent, strings: ShareStrings): string {
  switch (platform) {
    case 'x':
      return xText(content)
    case 'bluesky':
      return blueskyText(content)
    case 'threads':
      return threadsText(content)
    case 'linkedIn':
      return cut(richText(content, strings, { tags: 3 }), LINKEDIN_LIMIT)
    case 'whatsApp':
      return richText(content, strings, { boldTitle: true })
    case 'telegram':
      return richText(content, strings, { link: false })
    case 'reddit':
      return redditBody(content, strings)
    case 'email':
      return emailBody(content, strings)
    case 'facebook':
      // Facebook takes no text; this is what the menu copies for the reader to paste.
      return richText(content, strings)
  }
}

export function shareLinks(content: ShareContent, strings: ShareStrings): Record<SharePlatform, string> {
  const u = encodeURIComponent(content.url)
  const t = encodeURIComponent(content.title)
  const text = (platform: SharePlatform) => encodeURIComponent(shareText(platform, content, strings))
  return {
    x: `https://x.com/intent/post?text=${text('x')}`,
    linkedIn: `https://www.linkedin.com/feed/?shareActive=true&text=${text('linkedIn')}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    reddit: `https://www.reddit.com/submit?type=LINK&url=${u}&title=${t}&text=${text('reddit')}`,
    bluesky: `https://bsky.app/intent/compose?text=${text('bluesky')}`,
    threads: `https://www.threads.net/intent/post?text=${text('threads')}`,
    whatsApp: `https://wa.me/?text=${text('whatsApp')}`,
    telegram: `https://t.me/share/url?url=${u}&text=${text('telegram')}`,
    email: `mailto:?subject=${t}&body=${text('email')}`,
  }
}
