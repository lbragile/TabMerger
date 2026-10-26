import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'

describe('FeaturesPage', () => {
  it('wraps the Pro AI section cards in a styled surface2 container', async () => {
    render(await FeaturesPage())

    const aiHeading = screen.getByRole('heading', { name: 'AI-powered organization' })
    const aiSection = aiHeading.closest('div')?.parentElement as HTMLElement
    const wrapper = aiSection.querySelector('.bg-surface2')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toMatch(/rounded-md/)
    expect(wrapper?.className).toMatch(/border border-border/)
    expect(wrapper?.className).toMatch(/p-8/)
  })

  it('does not wrap the Core and Pro sections in the surface2 container', async () => {
    render(await FeaturesPage())

    const coreHeading = screen.getByRole('heading', { name: 'Powerful tab management' })
    const coreSection = coreHeading.closest('div')?.parentElement as HTMLElement
    expect(coreSection.querySelector('.bg-surface2')).toBeNull()

    const proHeading = screen.getByRole('heading', { name: 'Sync & sessions' })
    const proSection = proHeading.closest('div')?.parentElement as HTMLElement
    expect(proSection.querySelector('.bg-surface2')).toBeNull()
  })

  // The shortcuts work on every plan (see the pricing tiers), so the card must not sit under Pro.
  it('lists keyboard shortcuts in the Core section, not under Pro, without claiming every action has one', async () => {
    render(await FeaturesPage())

    const sectionOf = (heading: string) =>
      screen.getByRole('heading', { name: heading }).closest('div')?.parentElement as HTMLElement
    const core = sectionOf('Powerful tab management')
    const pro = sectionOf('Sync & sessions')

    expect(core.textContent).toContain('Keyboard shortcuts')
    expect(pro.textContent).not.toContain('Keyboard shortcuts')
    expect(document.body.textContent).not.toMatch(/every action has a keyboard shortcut/i)
  })

  it('restarts row numbering at "01" for each of the three tier sections', async () => {
    render(await FeaturesPage())

    const coreFirst = screen.getByText('Named & color-coded groups')
    const proFirst = screen.getByText('Cloud sync')
    const aiFirst = screen.getByText('Auto-grouping')

    expect(coreFirst.closest('div.grid')?.textContent).toContain('01')
    expect(proFirst.closest('div.grid')?.textContent).toContain('01')
    expect(aiFirst.closest('div.grid')?.textContent).toContain('01')

    const coreSecond = screen.getByText('Full-text search')
    expect(coreSecond.closest('div.grid')?.textContent).toContain('02')
  })

  it('lists all six Pro AI features, with Describe a group after naming and Organize last as row "06"', async () => {
    render(await FeaturesPage())

    const aiSection = screen.getByRole('heading', { name: 'AI-powered organization' }).closest('div')?.parentElement as HTMLElement
    const rowTitles = within(aiSection)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(rowTitles).toEqual(['Auto-grouping', 'Smart group names', 'Describe a group', 'Tab summaries', 'Session suggestions', 'Organize your workspace'])

    const describeRow = within(aiSection).getByRole('heading', { name: 'Describe a group' }).closest('div.grid') as HTMLElement
    expect(describeRow.textContent).toContain('03')
    expect(describeRow.textContent).toMatch(/writes a short note about what a group's tabs are about/)
    expect(describeRow.textContent).toMatch(/Edit it like any note/)

    const organizeRow = within(aiSection).getByRole('heading', { name: 'Organize your workspace' }).closest('div.grid') as HTMLElement
    expect(organizeRow.textContent).toContain('06')
    expect(organizeRow.textContent).toMatch(/proposes merges, renames, archives and a new order/)
    expect(organizeRow.textContent).toMatch(/in one step you can undo/)
  })

  // Own-key users can pick OpenAI, Anthropic or Google, so the Pro AI copy names no provider, and
  // session suggestions describe what they do (merge or archive saved groups), not browsing habits.
  it('keeps the Pro AI copy provider-neutral and accurate', async () => {
    render(await FeaturesPage())

    const aiSection = screen.getByRole('heading', { name: 'AI-powered organization' }).closest('div')?.parentElement as HTMLElement
    expect(aiSection.textContent).not.toMatch(/claude|anthropic|openai|gemini/i)
    expect(aiSection.textContent).toContain('AI reads your tab titles and URLs')
    expect(aiSection.textContent).not.toMatch(/browsing patterns/i)
    const sessionsRow = within(aiSection).getByRole('heading', { name: 'Session suggestions' }).closest('div.grid') as HTMLElement
    expect(sessionsRow.textContent).toMatch(/merging ones that overlap or archiving/)
  })
})
