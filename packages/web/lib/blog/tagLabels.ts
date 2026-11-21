import { getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, isAppLocale } from '@/i18n/locales'
import { BLOG_TAGS, type BlogTag } from '@/lib/blog/tags'

/**
 * A post's tag labels in `locale` (the shown file's language), for `keywords` and `article:tag`:
 * readable words, so the hyphens of the hashtag form become spaces ("save tabs").
 */
export async function tagKeywords(tags: readonly BlogTag[], locale: string): Promise<string[]> {
  const t = await getTranslations({ locale: isAppLocale(locale) ? locale : DEFAULT_LOCALE, namespace: 'blog' })
  return tags.map((tag) => t(`tags.${BLOG_TAGS[tag]}`).replace(/-/g, ' '))
}
