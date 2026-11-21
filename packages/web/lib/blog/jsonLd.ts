import { SITE_NAME } from '@/lib/seo'
import { getMetadataBase } from '@/lib/utils'
import { BLOG_AUTHOR, type Post } from '@/lib/blog/posts'

/**
 * A post's BlogPosting structured data: the same headline, description, dates and captures the
 * page shows, the author (always `BLOG_AUTHOR`, as a Person) and the site as publisher (the
 * homepage's Organization node, by `@id`). No interaction counts: the Helpful count loads in the
 * browser after the page, and structured data must match what is visible.
 *
 * `path` is the page's own URL path (with any locale prefix); `inLanguage` is the shown file's
 * locale, which is English on a locale without its own file. `keywords` are the post's tag labels
 * in that language; `citation` is the post's sources list.
 */
export function blogPostingJsonLd(
  post: Post,
  path: string,
  inLanguage: string,
  keywords: readonly string[] = [],
  base: URL = getMetadataBase()
) {
  const origin = base.origin
  const url = new URL(path, base).href
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    url,
    headline: post.title,
    description: post.description,
    inLanguage,
    datePublished: post.published,
    dateModified: post.updated,
    // The social card first (what shares show), then every capture in the post.
    image: [...(post.ogImage ? [post.ogImage.src] : []), ...post.images.map((image) => image.src)].map(
      (src) => new URL(src, base).href
    ),
    ...(keywords.length > 0 ? { keywords: keywords.join(', ') } : {}),
    ...(post.sources.length > 0
      ? {
          citation: post.sources.map((source) => ({
            '@type': 'CreativeWork',
            name: source.title,
            url: source.url,
            publisher: { '@type': 'Organization', name: source.publisher },
          })),
        }
      : {}),
    author: { '@type': 'Person', name: BLOG_AUTHOR.name, url: BLOG_AUTHOR.url },
    publisher: {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: SITE_NAME,
      url: `${origin}/`,
      logo: `${origin}/icon.png`,
    },
  }
}

/** The blog index's structured data: a Blog listing its posts. */
export function blogIndexJsonLd(
  posts: ReadonlyArray<{ post: Post; path: string }>,
  path: string,
  name: string,
  base: URL = getMetadataBase()
) {
  const url = new URL(path, base).href
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${url}#blog`,
    url,
    name,
    publisher: { '@id': `${base.origin}/#organization` },
    blogPost: posts.map(({ post, path: postPath }) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      url: new URL(postPath, base).href,
      datePublished: post.published,
      dateModified: post.updated,
      author: { '@type': 'Person', name: BLOG_AUTHOR.name, url: BLOG_AUTHOR.url },
    })),
  }
}
