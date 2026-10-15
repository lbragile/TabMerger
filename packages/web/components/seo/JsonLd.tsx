import { serializeJsonLd } from '@/lib/seo'

/** Structured data for search engines, serialised so no value can close the script element. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
}
