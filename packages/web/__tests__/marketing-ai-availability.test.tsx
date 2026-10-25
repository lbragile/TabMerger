/**
 * The marketing site's AI badges and copy follow AI_AVAILABILITY: "Coming soon" only while no
 * Pro AI option is on sale, a "With your own API key" note while only the own-key option ("You"
 * handle setup) is, and nothing extra once TabMerger handles setup too. Also the dashboard's AI
 * card for each option. AI_AVAILABILITY is computed at import, so each case reloads the modules.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

type State = 'off' | 'ownKeyOnly' | 'both'

function stub(state: State) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', state === 'both' ? 'true' : 'false')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', state === 'off' ? 'false' : 'true')
}

afterEach(() => vi.unstubAllEnvs())

describe.each([
  ['off', { comingSoon: true, ownKey: false }],
  ['ownKeyOnly', { comingSoon: false, ownKey: true }],
  ['both', { comingSoon: false, ownKey: false }],
] as const)('AI flags: %s', (state, expected) => {
  it('home page features: the AI row badge', async () => {
    stub(state)
    const { Features } = await import('@/components/marketing/Features')
    render(<Features />)
    expect(!!screen.queryByText('Coming soon')).toBe(expected.comingSoon)
    expect(!!screen.queryByText('With your own API key')).toBe(expected.ownKey)
    // The badge is a sibling of the heading, so its accessible name stays exact.
    expect(screen.getByRole('heading', { name: 'AI files the mess for you' })).toBeInTheDocument()
  })

  it('features page: the AI section badge', async () => {
    stub(state)
    const { default: FeaturesPage } = await import('@/app/[locale]/(marketing)/features/page')
    render(await FeaturesPage())
    expect(!!screen.queryByText('Coming soon')).toBe(expected.comingSoon)
    expect(!!screen.queryByText('With your own API key')).toBe(expected.ownKey)
  })

  it('final call to action: AI is offered once any option is on sale', async () => {
    stub(state)
    const { FinalCta } = await import('@/components/marketing/FinalCta')
    render(<FinalCta />)
    const lead = expected.comingSoon
      ? 'Free to start, no account needed. Upgrade any time for cloud sync — AI features coming soon.'
      : 'Free to start, no account needed. Upgrade any time for cloud sync and AI.'
    expect(screen.getByText(lead)).toBeInTheDocument()
  })

  it('FAQ: the AI answer says what is available', async () => {
    stub(state)
    const { FAQ } = await import('@/components/marketing/FAQ')
    render(<FAQ />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'What does the AI do exactly?' }))
    const answer = screen.getByText(/five AI features/)
    expect(answer.textContent).toMatch(/tab summaries \(.*session suggestions \(.*and Organize \(/)
    if (state === 'off') expect(answer.textContent).toMatch(/^Coming soon/)
    else if (state === 'ownKeyOnly') {
      expect(answer.textContent).toContain('For now, you handle setup: Pro AI runs on your own API key from Anthropic, OpenAI or Google')
      expect(answer.textContent).toContain('Setup handled by TabMerger is coming soon.')
    } else expect(answer.textContent).not.toMatch(/coming soon|your own API key/i)
  })
})

describe('dashboard AI card', () => {
  it('own key: who handles setup instead of credits, plus the action it is given', async () => {
    stub('ownKeyOnly')
    const { StatsOverview } = await import('@/components/dashboard/StatsOverview')
    render(
      <StatsOverview tabCount={1} groupCount={1} sessionCount={1} memberSince="2024-01-01"
        aiUsage={{ mode: 'byok', action: <button type="button">switch</button> }} />
    )
    expect(screen.getByText('AI setup')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'switch' })).toBeInTheDocument()
    expect(screen.queryByText('AI credits this month')).not.toBeInTheDocument()
  })

  it('managed and out of credits: credit packs are offered only while TabMerger setup is on sale', async () => {
    const usage = { mode: 'managed' as const, used: 2500, limit: 2500 }
    stub('ownKeyOnly')
    let { StatsOverview } = await import('@/components/dashboard/StatsOverview')
    const { unmount } = render(<StatsOverview tabCount={1} groupCount={1} sessionCount={1} memberSince="2024-01-01" aiUsage={usage} />)
    expect(screen.getByText('0 left, about 0 organizes of 300 tabs')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get more' })).not.toBeInTheDocument()
    unmount()

    stub('both')
    ;({ StatsOverview } = await import('@/components/dashboard/StatsOverview'))
    render(<StatsOverview tabCount={1} groupCount={1} sessionCount={1} memberSince="2024-01-01" aiUsage={usage} />)
    expect(screen.getByRole('button', { name: 'Get more' })).toBeInTheDocument()
  })
})
