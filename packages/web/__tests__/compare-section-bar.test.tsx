/**
 * The /compare section bar (previous / "NN / NN" + name / next). The scroll metrics come from
 * real layout (jsdom has none), so the box's hook is stubbed; real-layout behaviour (landing a
 * section under the product row) is in e2e/compare.spec.ts.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en'
import { NAV_LINKS } from '@/components/layout/navLinks'
import { MobileNavToggle } from '@/components/layout/MobileNavToggle'

const { scroll } = vi.hoisted(() => ({ scroll: { current: null as unknown } }))
vi.mock('@/components/compare/CompareScrollBox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/compare/CompareScrollBox')>()),
  useCompareScroll: () => scroll.current,
}))

import { CompareSectionBar } from '@/components/compare/CompareSectionBar'

const table = en.compare.table as Record<string, string>
const groups = Object.values(en.compare.groups as Record<string, string>)
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)(?:, number)?\}/g, (_, k) => String(vars[k]))
const goToSection = vi.fn()

function setSection(section: number, overflowY = true) {
  scroll.current = {
    metrics: { section, overflowY, width: 800 },
    goToSection,
    labels: {
      sections: groups,
      previousSection: table.previousSection,
      nextSection: table.nextSection,
      goToPreviousSection: groups.map((name) => fill(table.goToPreviousSection, { name })),
      goToNextSection: groups.map((name) => fill(table.goToNextSection, { name })),
      sectionOf: groups.map((_, i) => fill(table.sectionOf, { current: i + 1, total: groups.length })),
    },
  }
}

beforeEach(() => goToSection.mockClear())

describe('CompareSectionBar', () => {
  it('shows "NN / NN", the current section name, and names the neighbours on the buttons', async () => {
    setSection(3)
    const { container } = render(<CompareSectionBar />)
    expect(container.textContent).toContain('04 / 08')
    expect(screen.getByText(groups[3], { selector: 'span.truncate.text-sm' })).toBeInTheDocument()
    const prev = screen.getByRole('button', { name: `Previous section: ${groups[2]}` })
    const next = screen.getByRole('button', { name: `Next section: ${groups[4]}` })
    expect(prev).toBeEnabled()
    expect(next).toBeEnabled()
    expect(prev).toHaveTextContent(groups[2])
    expect(next).toHaveTextContent(groups[4])
    await userEvent.setup().click(next)
    expect(goToSection).toHaveBeenCalledWith(4)
    await userEvent.setup().click(prev)
    expect(goToSection).toHaveBeenCalledWith(2)
  })

  it('first section: previous is disabled with no name; progress is 1/8', () => {
    setSection(0)
    const { container } = render(<CompareSectionBar />)
    const prev = screen.getByRole('button', { name: 'Previous section' })
    expect(prev).toBeDisabled()
    expect(prev.textContent).toBe('')
    expect(screen.getByRole('button', { name: `Next section: ${groups[1]}` })).toBeEnabled()
    expect(container.textContent).toContain('01 / 08')
    expect((container.querySelector('span.bg-primary') as HTMLElement).style.width).toBe('12.5%')
  })

  it('last section: next is disabled with no name; progress is 100%', () => {
    setSection(7)
    const { container } = render(<CompareSectionBar />)
    const next = screen.getByRole('button', { name: 'Next section' })
    expect(next).toBeDisabled()
    expect(next.textContent).toBe('')
    expect(screen.getByRole('button', { name: `Previous section: ${groups[6]}` })).toBeEnabled()
    expect(container.textContent).toContain('08 / 08')
    expect((container.querySelector('span.bg-primary') as HTMLElement).style.width).toBe('100%')
  })

  it('progress width is (i+1)/total for every section', () => {
    groups.forEach((_, i) => {
      setSection(i)
      const { container, unmount } = render(<CompareSectionBar />)
      expect((container.querySelector('span.bg-primary') as HTMLElement).style.width).toBe(`${((i + 1) / groups.length) * 100}%`)
      unmount()
    })
  })

  it('has hidden "Section n of 8" text, a visual counter hidden from assistive tech, and no live region', () => {
    setSection(4)
    const { container } = render(<CompareSectionBar />)
    expect(container.querySelector('.sr-only')).toHaveTextContent('Section 5 of 8')
    expect(container.querySelector('[dir="ltr"]')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[role="status"],[role="alert"],[role="log"]')).toBeNull()
  })

  it('renders nothing while the box does not scroll vertically, or outside the box', () => {
    setSection(0, false)
    expect(render(<CompareSectionBar />).container).toBeEmptyDOMElement()
    scroll.current = null
    expect(render(<CompareSectionBar />).container).toBeEmptyDOMElement()
  })
})

describe('NAV_LINKS', () => {
  it('lists Features, Pricing, Compare, Changelog, FAQ in that order', () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual(['features', 'pricing', 'compare', 'changelog', 'faq'])
    expect(NAV_LINKS.map((l) => l.href)).toEqual(['/features', '/pricing', '/compare', '/changelog', '/faq'])
  })

  it('only Changelog steps out of the bar below xl', () => {
    expect(NAV_LINKS.filter((l) => l.barFromXl).map((l) => l.label)).toEqual(['changelog'])
  })

  it('the mobile menu still lists every link, Changelog included, in order', async () => {
    const user = userEvent.setup()
    render(<MobileNavToggle />)
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const panel = screen.getByRole('navigation', { name: en.nav.mobileMenu })
    const names = within(panel).getAllByRole('link').map((a) => a.textContent)
    const expected = NAV_LINKS.map((l) => (en.nav as Record<string, string>)[l.label])
    expect(names.slice(0, expected.length)).toEqual(expected)
    expect(within(panel).getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/changelog')
  })
})
