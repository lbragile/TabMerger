'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { FigureFrame } from '@/components/blog/FigureFrame'
import type { PostBox } from '@/lib/blog/figures'
import { cn } from '@/lib/utils'

/**
 * A TabMerger capture that exists in a light and a dark version (`<src>-light.webp`,
 * `<src>-dark.webp`). It follows the page theme by default and the "Light / Dark screenshots"
 * toggle when the reader picks one.
 *
 * Following the page theme is done in CSS (`dark:` classes on both images), not from the theme
 * read in JavaScript, so the server HTML is already right for a dark-theme reader and nothing
 * swaps on hydration. A `display: none` lazy image isn't fetched, so only one version loads.
 */
export function ThemedScreenshot({
  src,
  alt,
  darkAlt,
  width = 1600,
  height = 1200,
  boxes,
  figure,
  source,
  small = false,
  className,
  children,
}: {
  /** Path without the `-light.webp` / `-dark.webp` suffix. */
  src: string
  alt: string
  darkAlt: string
  width?: number
  height?: number
  boxes?: readonly PostBox[]
  /** Set by rehype-figure-numbers.mjs; never written in a post. */
  figure?: number | string
  /** What it was captured from ("TabMerger 3.14.0"). */
  source?: string
  small?: boolean
  className?: string
  children?: ReactNode
}) {
  const { screenshotOverride } = useBlogPostState()
  const image = (theme: 'light' | 'dark', visibility?: string) => (
    <Image
      key={theme}
      unoptimized
      src={`${src}-${theme}.webp`}
      alt={theme === 'dark' ? darkAlt : alt}
      width={width}
      height={height}
      loading="lazy"
      className={cn('block h-auto w-full', visibility)}
    />
  )
  return (
    <FigureFrame
      className={className ?? 'mb-6'}
      boxes={boxes}
      figure={figure}
      source={source}
      zoom={{
        src: { light: `${src}-light.webp`, dark: `${src}-dark.webp` },
        alt: { light: alt, dark: darkAlt },
        width,
        height,
      }}
      small={small}
      caption={children}
      image={
        screenshotOverride ? (
          image(screenshotOverride)
        ) : (
          <>
            {image('light', 'dark:hidden')}
            {image('dark', 'hidden dark:block')}
          </>
        )
      }
    />
  )
}

/**
 * "Dark screenshots / Light screenshots": overrides the theme of every TabMerger capture in the
 * post. The pressed button is the theme in effect (the page theme until the reader picks one).
 */
export function ScreenshotThemeToggle() {
  const t = useTranslations('blog.interactive')
  const { screenshotTheme, setScreenshotTheme } = useBlogPostState()
  return (
    <div role="group" aria-label={t('screenshotTheme')} className="mb-5 inline-flex border border-border2">
      {(['dark', 'light'] as const).map((theme) => {
        const pressed = screenshotTheme === theme
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={pressed}
            onClick={() => setScreenshotTheme(theme)}
            className={cn(
              'min-h-11 px-4 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              pressed ? 'bg-foreground text-background' : 'bg-transparent text-foreground hover:bg-surface3'
            )}
          >
            {theme === 'dark' ? t('darkScreenshots') : t('lightScreenshots')}
          </button>
        )
      })}
    </div>
  )
}
