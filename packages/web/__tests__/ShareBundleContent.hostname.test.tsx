import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShareBundleContent } from '@/components/ShareBundleContent'

describe('ShareBundleContent — truncated URL display', () => {
  const bundle = {
    slug: 'test-slug',
    expiresAt: null,
    groups: [
      {
        id: 'group-a',
        name: 'Group A',
        color: 'rgba(0,0,0,1)',
        windows: [
          {
            id: 0,
            incognito: false,
            focused: false,
            tabs: [
              { id: 0, title: 'GitHub', url: 'https://www.github.com/foo' },
              { id: 1, title: 'No URL tab' },
              { id: 2, title: 'Bad Tab', url: 'not-a-valid-url' },
            ],
          },
        ],
      },
    ],
  }

  it('shows the URL truncated to 20 characters next to the tab title', () => {
    render(<ShareBundleContent bundle={bundle} />)
    expect(screen.getByText('https://www.github.c…')).toBeInTheDocument()
  })

  it('does not render a URL span for tabs without a valid url', () => {
    render(<ShareBundleContent bundle={bundle} />)
    expect(screen.getByText('No URL tab')).toBeInTheDocument()
    expect(screen.getByText('Bad Tab')).toBeInTheDocument()
    expect(screen.queryByText('not-a-valid-url')).not.toBeInTheDocument()
  })

  it('renders a diamond separator before the URL', () => {
    render(<ShareBundleContent bundle={bundle} />)
    expect(screen.getByText('◆')).toBeInTheDocument()
  })

  it('does not truncate URLs already 20 characters or shorter', () => {
    const shortBundle = {
      ...bundle,
      groups: [{
        ...bundle.groups[0],
        windows: [{ ...bundle.groups[0].windows[0], tabs: [{ id: 0, title: 'Short', url: 'https://a.io' }] }],
      }],
    }
    render(<ShareBundleContent bundle={shortBundle} />)
    expect(screen.getByText('https://a.io/')).toBeInTheDocument()
  })
})
