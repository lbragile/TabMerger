/**
 * The blog's topic tags: a controlled vocabulary, so tag pages stay few and meaningful. The slug
 * is the URL segment (`/blog/tags/<slug>`, English, kebab-case, never changed once published); the
 * label is translated (`blog.tags.<key>`) and shown after a "#". A post lists 3 to 8 of these in
 * `post.tags` (checked by `parsePost`). To add a tag, add it here and to every `blog.json`.
 */
export const BLOG_TAGS = {
  'tab-management': 'tabManagement',
  'tab-manager': 'tabManager',
  'save-tabs': 'saveTabs',
  'restore-closed-tabs': 'restoreClosedTabs',
  bookmarks: 'bookmarks',
  'session-management': 'sessionManagement',
  'browser-productivity': 'browserProductivity',
  'browser-tips': 'browserTips',
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
} as const satisfies Record<string, string>

export type BlogTag = keyof typeof BLOG_TAGS

export const BLOG_TAG_SLUGS = Object.keys(BLOG_TAGS) as [BlogTag, ...BlogTag[]]

/** Fewest and most tags a post may list. */
export const POST_TAGS_MIN = 3
export const POST_TAGS_MAX = 8

/**
 * A tag page is indexable once this many posts carry the tag; below it the page is
 * `noindex, follow` (a thin page) and left out of the sitemap.
 */
export const TAG_INDEX_MIN_POSTS = 3

export function isBlogTag(value: unknown): value is BlogTag {
  return typeof value === 'string' && Object.hasOwn(BLOG_TAGS, value)
}

/** Path of a tag's page, without a locale prefix. */
export function blogTagPath(tag: BlogTag): string {
  return `/blog/tags/${tag}`
}
