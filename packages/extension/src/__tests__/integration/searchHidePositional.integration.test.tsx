import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { SEARCH_COPY } from '@tabmerger/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowsPanel } from '@/components/Windows'
import { useGroups } from '@/hooks/useGroups'
import { getGroupsState, saveGroupsState, setSetting } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_APP_SETTINGS } from '@/hooks/useAppSettings'
import type { GroupsState } from '@/lib/types'
import { clearDb } from './dbTestUtils'

// Real IndexedDB, real hooks, real WindowsPanel/Window/Tab: in "hide" mode the panel does not
// render non-matching tabs, but every action on a row that IS shown must still hit that
// row's REAL position in the saved data.

const TITLES = ['alpha one', 'beta', 'alpha two', 'gamma', 'alpha three']

async function seed(): Promise<void> {
  const nowOpen = createNowOpenGroup()
  const work = createGroup('work', 'Work')
  work.windows = [createWindow(TITLES.map((t, i) => createTab(t, `https://example.com/${i}`)))]
  const state: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen, work] }
  await saveGroupsState(state)
}

function Panel() {
  const { data } = useGroups()
  const group = data?.available[1]
  if (!group || !data) return null
  return <WindowsPanel group={group} groupIndex={1} allGroups={data.available} />
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Panel />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

const visibleTitles = () => screen.queryAllByRole('listitem').map((el) => el.getAttribute('aria-label'))

beforeEach(async () => {
  await clearDb()
  useUIStore.setState({ searchFilter: '' })
  vi.mocked(chrome.tabs.create).mockClear()
})

describe('hide mode keeps positional indices', () => {
  it('removing the 2nd visible tab deletes its real (index 2) tab, not index 1', async () => {
    await seed()
    useUIStore.setState({ searchFilter: 'alpha' })
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => expect(visibleTitles()).toEqual(['alpha one', 'alpha two', 'alpha three']))
    const row = screen.getByRole('listitem', { name: 'alpha two' })
    await user.click(within(row).getByRole('button', { name: 'Remove tab' }))

    await waitFor(async () => {
      const win = (await getGroupsState()).available[1].windows[0]
      expect(win.tabs.map((t) => t.title)).toEqual(['alpha one', 'beta', 'gamma', 'alpha three'])
    })
  })

  it('opening the last visible tab opens the URL of its real index (4)', async () => {
    await seed()
    useUIStore.setState({ searchFilter: 'alpha' })
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => expect(visibleTitles()).toHaveLength(3))
    // the match is wrapped in <mark>, so find the title span by its whole text
    const row = screen.getByRole('listitem', { name: 'alpha three' })
    await user.click(within(row).getAllByText((_c, el) => el?.tagName === 'SPAN' && el.textContent === 'alpha three').at(-1)!)
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/4', active: true })
  })

  it('dim mode keeps every row and the same positional removal', async () => {
    await seed()
    await setSetting('appSettings', { ...DEFAULT_APP_SETTINGS, searchNonMatching: 'dim' })
    useUIStore.setState({ searchFilter: 'alpha' })
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => expect(visibleTitles()).toHaveLength(5))
    // a faded row says so to a screen reader too
    expect(screen.getByRole('listitem', { name: `beta${SEARCH_COPY.noMatchSuffix}` })).toHaveClass('opacity-60')
    await user.click(within(screen.getByRole('listitem', { name: 'alpha two' })).getByRole('button', { name: 'Remove tab' }))
    await waitFor(async () => {
      const win = (await getGroupsState()).available[1].windows[0]
      expect(win.tabs.map((t) => t.title)).toEqual(['alpha one', 'beta', 'gamma', 'alpha three'])
    })
  })
})

// Search is contiguous-only: the query must occur in the title/address as one run of characters.
describe('contiguous search against real saved data', () => {
  async function seedJira(): Promise<void> {
    const nowOpen = createNowOpenGroup()
    const work = createGroup('work', 'Work')
    work.windows = [
      createWindow([
        createTab('Confluence', 'https://confluence.example.org/'),
        createTab('Jira Board', 'https://tracker.example.net/board'),
        createTab('Slack', 'https://chat.example.io/'),
      ]),
    ]
    await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, work] })
  }

  it('hide mode: "jra" (letters in order, not adjacent) shows no row', async () => {
    await seedJira()
    useUIStore.setState({ searchFilter: 'jra' })
    renderPanel()
    // the panel mounts only once the saved data has loaded; then nothing is listed
    await screen.findByTestId('windows-panel-scroll')
    expect(visibleTitles()).toEqual([])
  })

  it('hide mode: "jir" shows the Jira tab with the run highlighted', async () => {
    await seedJira()
    useUIStore.setState({ searchFilter: 'jir' })
    renderPanel()
    await waitFor(() => expect(visibleTitles()).toEqual(['Jira Board']))
    expect(screen.getByRole('listitem', { name: 'Jira Board' }).querySelector('mark')?.textContent).toBe('Jir')
  })

  it('dim mode: "jra" dims every row, "jir" dims all but the Jira tab', async () => {
    await seedJira()
    await setSetting('appSettings', { ...DEFAULT_APP_SETTINGS, searchNonMatching: 'dim' })
    useUIStore.setState({ searchFilter: 'jra' })
    const { unmount } = renderPanel()
    await waitFor(() => expect(visibleTitles()).toHaveLength(3))
    for (const el of screen.getAllByRole('listitem')) expect(el).toHaveClass('opacity-60')
    unmount()

    useUIStore.setState({ searchFilter: 'jir' })
    renderPanel()
    await waitFor(() => expect(visibleTitles()).toHaveLength(3))
    expect(screen.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass('opacity-60')
    expect(screen.getByRole('listitem', { name: `Slack${SEARCH_COPY.noMatchSuffix}` })).toHaveClass('opacity-60')
  })

  it('under "jir" the shown Jira row still removes its real index (1), and an address match works too', async () => {
    await seedJira()
    useUIStore.setState({ searchFilter: 'tracker' }) // matches only the Jira tab's address
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(visibleTitles()).toEqual(['Jira Board']))
    await user.click(within(screen.getByRole('listitem', { name: 'Jira Board' })).getByRole('button', { name: 'Remove tab' }))
    await waitFor(async () => {
      const win = (await getGroupsState()).available[1].windows[0]
      expect(win.tabs.map((t) => t.title)).toEqual(['Confluence', 'Slack'])
    })
  })
})
