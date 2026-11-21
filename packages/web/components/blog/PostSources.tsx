import { getFormatter, getTranslations } from 'next-intl/server'
import { CopyLinkButton } from '@/components/blog/CopyLinkButton'
import type { Post } from '@/lib/blog/posts'

/** "Nov 19, 2026" for a YYYY-MM-DD date, in the page's language (UTC, so it never shifts a day). */
async function formatDay() {
  const format = await getFormatter()
  return (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })
}

/**
 * A post's "Sources", a quiet card: an ordered list of the pages it relies on (the linked title
 * with its copy button, then "publisher · checked <date>", an optional note), and a footnote saying
 * who captured the screenshots and when (not a source). The same
 * list is the BlogPosting `citation` (lib/blog/jsonLd.ts). Section id `sources`, listed in the
 * contents. Links to other sites open in a new tab, like the post body's (rehype-external-links).
 */
export async function PostSources({ post, contentLang }: { post: Post; contentLang?: string }) {
  if (post.sources.length === 0) return null
  const t = await getTranslations('blog')
  const day = await formatDay()
  const captured = post.screenshotsCaptured ?? post.published
  return (
    <section
      id="sources"
      aria-labelledby="sources-h"
      className="blog-section mb-10 mt-16 scroll-mt-24 rounded-[var(--radius)] bg-surface2 px-5 py-6 sm:px-7"
    >
      <h2 id="sources-h" className="mb-4 font-mono text-xs font-medium uppercase tracking-wider text-text3">
        {t('sources')}
      </h2>
      <ol className="m-0 flex list-decimal flex-col gap-4 ps-5 text-[0.9375rem] leading-relaxed marker:text-text3">
        {post.sources.map((source) => (
          <li key={source.url} className="group/link ps-1">
            <span className="inline-flex flex-wrap items-center gap-x-1">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                lang={contentLang}
                className="font-semibold text-primary underline underline-offset-[0.18em] hover:text-primary/80"
              >
                {source.title}
              </a>
              <CopyLinkButton url={source.url} />
            </span>
            <span className="block text-sm text-text3">
              <span lang={contentLang}>{source.publisher}</span>
              {' · '}
              {t.rich('sourceChecked', {
                date: day(source.checked),
                time: (chunks) => <time dateTime={source.checked}>{chunks}</time>,
              })}
            </span>
            {source.note && (
              <span lang={contentLang} className="block text-sm text-text3">
                {source.note}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="mb-0 mt-5 text-xs text-text3">
        {t.rich('screenshotsCredit', {
          date: day(captured),
          time: (chunks) => <time dateTime={captured}>{chunks}</time>,
        })}
      </p>
    </section>
  )
}
