import { useTranslations } from 'next-intl'
import { ChromeIcon, EdgeIcon, FirefoxIcon } from '@/components/marketing/BrowserIcons'
import { cn } from '@/lib/utils'

const ICONS = { Chrome: ChromeIcon, Edge: EdgeIcon, Firefox: FirefoxIcon } as const

/** "Chrome 157.0.8103.79" → { name: "Chrome", major: "Chrome 157" } (the full build stays with it). */
export function splitVersion(entry: string): { name: string; major: string } {
  const match = /^(.*?)\s+(\d+)(?:\.\d+)*$/.exec(entry.trim())
  return match ? { name: match[1], major: `${match[1]} ${match[2]}` } : { name: entry, major: entry }
}

/**
 * "Tested on" and the browsers as small pills: the browser's icon and major version
 * ("Chrome 157"). The full build is the pill's tooltip and what screen readers hear; the post data
 * (and structured data) keeps it unchanged. A list named by the label; the date is the byline's.
 */
export function TestedOn({
  versions,
  lang,
  className,
  id = 'tested-on-label',
}: {
  versions: readonly string[]
  lang?: string
  className?: string
  /** The label's id (unique per page: post cards pass their own). */
  id?: string
}) {
  const t = useTranslations('blog.rail')
  if (versions.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs', className)}>
      <span id={id} className="text-text3">
        {t('testedOn')}
      </span>
      <ul aria-labelledby={id} lang={lang} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {versions.map((version) => {
          const { name, major } = splitVersion(version)
          const Icon = ICONS[name as keyof typeof ICONS]
          return (
            <li
              key={version}
              title={version}
              className="inline-flex min-h-6 items-center gap-1.5 border border-border bg-surface2 px-2 text-text2"
            >
              {Icon && (
                <span aria-hidden="true" className="inline-flex">
                  <Icon size={12} />
                </span>
              )}
              <span aria-hidden="true">{major}</span>
              <span className="sr-only">{version}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
