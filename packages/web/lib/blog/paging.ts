import { BLOG_PATH } from '@/lib/blog/posts'
import { blogTagPath, type BlogTag } from '@/lib/blog/tags'

/** Posts per page on the blog index and tag pages (page 1 counts the featured post). */
export const POSTS_PER_PAGE = 10

/** Bounds for the dev-only page-size override. */
const DEV_PAGE_SIZE_MAX = 50

/**
 * The page size: 10, or `BLOG_DEV_PLACEHOLDERS_PER_PAGE` (a whole number from 1 to 50) under
 * `next dev` only, so the pager can be seen locally with the few placeholder posts. Production,
 * preview and tests always use 10.
 */
export function blogPageSize(env: { NODE_ENV?: string; BLOG_DEV_PLACEHOLDERS_PER_PAGE?: string } = process.env): number {
  if (env.NODE_ENV !== 'development') return POSTS_PER_PAGE
  const raw = env.BLOG_DEV_PLACEHOLDERS_PER_PAGE?.trim()
  if (!raw || !/^\d+$/.test(raw)) return POSTS_PER_PAGE
  const size = Number(raw)
  return size >= 1 && size <= DEV_PAGE_SIZE_MAX ? size : POSTS_PER_PAGE
}

/** How many pages `total` posts fill (at least one, so an empty blog still has its index). */
export function pageCount(total: number, size: number = blogPageSize()): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)))
}

/**
 * A page number from the URL (`/blog/page/<n>`): a whole number without a sign, leading zeros or
 * anything else; `null` for any other value. Range checks are the caller's (`pageCount`).
 */
export function parsePageParam(raw: string): number | null {
  return /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : null
}

/** The posts on page `page` (1-based) of `items`. */
export function pageItems<T>(items: readonly T[], page: number, size: number = blogPageSize()): T[] {
  return items.slice((page - 1) * size, page * size)
}

/** Path of a blog index page: `/blog` for page 1, `/blog/page/<n>` after. */
export function blogIndexPagePath(page: number): string {
  return page <= 1 ? BLOG_PATH : `${BLOG_PATH}/page/${page}`
}

/** Path of a tag page: `/blog/tags/<tag>` for page 1, `/blog/tags/<tag>/page/<n>` after. */
export function blogTagPagePath(tag: BlogTag, page: number): string {
  return page <= 1 ? blogTagPath(tag) : `${blogTagPath(tag)}/page/${page}`
}

/** The page numbers after the first: what `generateStaticParams` and the sitemap list. */
export function laterPages(total: number, size: number = blogPageSize()): number[] {
  return Array.from({ length: pageCount(total, size) - 1 }, (_, i) => i + 2)
}
