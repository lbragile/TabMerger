/**
 * Guard: blog components render real English text, never a message key path such as
 * "blog.sources" (what next-intl prints for a missing message). The test intl helper also throws
 * on a missing `blog.*` message, so a new `t()` call without its English entry fails here.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArticleBar } from '@/components/blog/ArticleBar'
import { AnnotatedFigure } from '@/components/blog/AnnotatedFigure'
import { BlogPostStateProvider } from '@/components/blog/BlogPostState'
import { BrowserSwitcher, RailBrowserSwitcher } from '@/components/blog/BrowserSwitcher'
import { FigureLightbox } from '@/components/blog/FigureLightbox'
import { TagChips } from '@/components/blog/TagChips'
import { ScreenshotThemeToggle } from '@/components/blog/ThemedScreenshot'

const RAW_KEY = /\bblog\.[a-zA-Z]+(\.[a-zA-Z]+)+/

function expectNoRawKeys(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(RAW_KEY)
  for (const el of container.querySelectorAll('[aria-label],[title],[alt]')) {
    for (const attr of ['aria-label', 'title', 'alt']) expect(el.getAttribute(attr) ?? '').not.toMatch(RAW_KEY)
  }
}

const share = {
  url: 'https://example.test/blog/save-all-open-tabs',
  title: 'How to save all open tabs',
  description: 'Save every open tab.',
  summary: 'Ctrl+Shift+D and more.',
  hashtags: ['SaveTabs'],
  origin: 'https://example.test',
  downloadUrl: 'https://example.test/download',
  githubUrl: 'https://github.com/example/repo',
}

describe('blog components show no raw message keys', () => {
  it('article bar, share menu, switchers, theme toggle, tags and a numbered figure', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <BlogPostStateProvider browserSections={['bookmark']}>
        <FigureLightbox>
          <ArticleBar slug="save-all-open-tabs" readTime="3 min read" share={share} returnPath="/blog/save-all-open-tabs#helpful" />
          <BrowserSwitcher />
          <RailBrowserSwitcher fact={{ label: 'Startup setting', values: { chrome: 'chrome://a', edge: 'edge://b', firefox: 'about:c' } }} />
          <ScreenshotThemeToggle />
          <TagChips tags={['save-tabs', 'chrome', 'edge']} />
          <AnnotatedFigure
            src="/blog/save-all-open-tabs/chrome-bookmarks-folder.webp"
            alt="Chrome bookmark manager"
            width={1600}
            height={524}
            figure="1"
            boxes={[
              { l: 1, t: 1, w: 10, h: 10, id: 'a', label: 'First' },
              { l: 50, t: 50, w: 10, h: 10, id: 'b', label: 'Second' },
            ]}
          >
            A description.
          </AnnotatedFigure>
        </FigureLightbox>
      </BlogPostStateProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByText('Figure 1')).toBeInTheDocument()
    expect(screen.getByText('Marker 1:')).toBeInTheDocument()
    expectNoRawKeys(container)
  })
})
