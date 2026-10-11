/**
 * Separate test file (not co-located with contact-page.test.tsx) for the
 * ?topic= preselection behavior added for the /beta page's bug-report and
 * feedback links. Needs its own next/navigation mock with a mutable search
 * string, which turned out to interact badly with contact-page.test.tsx's
 * other describe block when both lived in one file (render() would hang
 * until the vitest test timeout) — kept isolated here instead.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockSearch = vi.hoisted(() => ({ value: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/contact',
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}))

import ContactPage from '@/app/(marketing)/contact/page'

describe('ContactPage — ?topic= preselection', () => {
  afterEach(() => {
    mockSearch.value = ''
  })

  it('preselects "Beta bug report" when ?topic=beta is in the URL', async () => {
    mockSearch.value = 'topic=beta'
    render(<ContactPage />)
    const combobox = await screen.findByRole('combobox', { name: /subject/i })
    expect(combobox).toHaveTextContent('Beta bug report')
  })

  it('preselects "Feedback and ideas" when ?topic=feedback is in the URL', async () => {
    mockSearch.value = 'topic=feedback'
    render(<ContactPage />)
    const combobox = await screen.findByRole('combobox', { name: /subject/i })
    expect(combobox).toHaveTextContent('Feedback and ideas')
  })

  it('leaves the subject unselected with no ?topic= param', async () => {
    render(<ContactPage />)
    expect(await screen.findByText('Select a reason…')).toBeInTheDocument()
  })

  it.each(['unknown', 'toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'leaves the subject unselected for the topic %j',
    async (topic) => {
      mockSearch.value = `topic=${topic}`
      render(<ContactPage />)
      const combobox = await screen.findByRole('combobox', { name: /subject/i })
      expect(combobox).toHaveTextContent('Select a reason…')
    }
  )
})
