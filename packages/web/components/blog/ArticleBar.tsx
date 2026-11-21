'use client'

import { useTranslations } from 'next-intl'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { HelpfulButton } from '@/components/blog/HelpfulButton'
import { ShareMenu } from '@/components/blog/ShareMenu'
import type { ShareContent } from '@/lib/blog/share'

/**
 * The bar under a post's byline: read time, Helpful, Share, and one polite live region that
 * announces what Helpful and Share did ("Link copied.", "Thanks. Marked as helpful.").
 */
export function ArticleBar({
  slug,
  readTime,
  share,
  returnPath,
}: {
  slug: string
  /** "7 min read", already translated (the page knows the minutes). */
  readTime: string
  /** What the Share menu shares (lib/blog/share.ts). */
  share: ShareContent
  /** Where sign-in returns to (the post's path with `#helpful`). */
  returnPath: string
}) {
  const t = useTranslations('blog.interactive')
  // The page's one live region: copy buttons in the article announce here too.
  const { notice, announce: setNotice } = useBlogPostState()
  return (
    <div id="helpful" className="scroll-mt-24">
      <div
        role="group"
        aria-label={t('articleActions')}
        className="flex flex-wrap items-center gap-2 border-y border-border py-2.5"
      >
        <span className="me-auto inline-flex items-center gap-1.5 text-sm text-text2">
          <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {readTime}
        </span>
        <HelpfulButton slug={slug} returnPath={returnPath} announce={setNotice} />
        <ShareMenu content={share} announce={setNotice} />
      </div>
      <p role="status" aria-live="polite" className="mt-1.5 min-h-5 break-words text-sm text-primary">
        {notice}
      </p>
    </div>
  )
}
