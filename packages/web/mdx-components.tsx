import type { MDXComponents } from 'mdx/types'
import { AnnotatedFigure } from '@/components/blog/AnnotatedFigure'
import { BrowserPanel, BrowserPanels } from '@/components/blog/BrowserPanels'
import { Carousel } from '@/components/blog/Carousel'
import { FigureGrid } from '@/components/blog/FigureFrame'
import { InstallCta } from '@/components/blog/InstallCta'
import { BrowserUrl, Catch, ComparisonTable, Faq, Kbd, POST_ELEMENTS, QuickAnswer, Section } from '@/components/blog/PostBody'
import { BrowserSwitcher } from '@/components/blog/BrowserSwitcher'
import { ScreenshotThemeToggle, ThemedScreenshot } from '@/components/blog/ThemedScreenshot'

/**
 * Components available to every MDX file (`@next/mdx` requires this file in the App Router). Only
 * the blog's posts (content/blog/<slug>/<locale>.mdx) are MDX. A post uses these by name without
 * importing them; the page around it (layout, contents, rail, Helpful, Share) is the post page's,
 * not the MDX's. Section headings come from `<Section id title>`, so their ids are written in the
 * post and stay the same when it's translated (no heading-slug plugin).
 */
const components: MDXComponents = {
  ...POST_ELEMENTS,
  Section,
  QuickAnswer,
  Catch,
  Kbd,
  BrowserPanels,
  BrowserPanel,
  AnnotatedFigure,
  ThemedScreenshot,
  ScreenshotThemeToggle,
  FigureGrid,
  Carousel,
  ComparisonTable,
  Faq,
  InstallCta,
  BrowserUrl,
  BrowserSwitcher,
}

export function useMDXComponents(): MDXComponents {
  return components
}
