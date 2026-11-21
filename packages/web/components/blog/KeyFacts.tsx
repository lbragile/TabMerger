import { useTranslations } from 'next-intl'
import { FREE_TIER_LIMITS } from '@tabmerger/shared'
import { BlogInstallCta } from '@/components/blog/BlogInstallCta'
import { RailBrowserSwitcher } from '@/components/blog/BrowserSwitcher'
import { PostLink } from '@/components/blog/PostBody'
import { getStoreLinks } from '@/lib/storeLinks'
import type { Post } from '@/lib/blog/posts'

const LABEL = 'mb-1.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wider'

/**
 * The post's rail (`aside` "Key facts"), one compact card sized to fit beside the article without
 * scrolling at 1280×720: the browser switcher's second copy with the post's per-browser fact,
 * the key facts (each with its source inline) and the install buttons (the tested versions are
 * under the byline). Headings follow the site's language; the
 * facts are the post's (`lang` when the post is shown in English on another locale).
 */
export function KeyFacts({ post, contentLang }: { post: Post; contentLang?: string }) {
  const t = useTranslations('blog.rail')
  return (
    <aside
      aria-label={t('label')}
      className="min-w-0 divide-y divide-border border border-border bg-surface2 text-sm leading-[1.45]"
    >
      {post.browserSections.length > 0 && (
        <section aria-labelledby="rail-browser-h" className="p-3">
          <h2 id="rail-browser-h" className={`${LABEL} text-text3`}>
            {t('yourBrowser')}
          </h2>
          <div lang={contentLang}>
            <RailBrowserSwitcher fact={post.browserFact} />
          </div>
        </section>
      )}
      {post.keyFacts.length > 0 && (
        <section aria-labelledby="rail-facts-h" className="p-3">
          <h2 id="rail-facts-h" className={`${LABEL} text-accent-foreground dark:text-secondary`}>
            {t('keyFacts')}
          </h2>
          <ul lang={contentLang} className="m-0 flex list-none flex-col gap-1.5 p-0">
            {post.keyFacts.map((fact) => (
              <li key={fact.text}>
                {fact.text}{' '}
                <span className="text-[0.8125rem] text-text3">
                  {'· '}
                  {fact.href ? <PostLink href={fact.href}>{fact.source}</PostLink> : fact.source}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="rail-cta-h" className="p-3">
        <h2 id="rail-cta-h" className="mb-1 text-[0.9375rem] font-bold">
          {t('tryHeading')}
        </h2>
        <p className="mb-2 text-[0.8125rem] text-text2">
          {t('tryLead', { groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs })}
        </p>
        <BlogInstallCta links={getStoreLinks()} layout="compact" />
      </section>
    </aside>
  )
}
