import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openTabInChromeGroup } from '@/lib/chromeGroups'

describe('openTabInChromeGroup', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 5, windowId: 10 }),
        group: vi.fn().mockResolvedValue(99),
      },
      tabGroups: {
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('opens the tab without grouping when tab has no chromeGroup', async () => {
    await openTabInChromeGroup({ id: 1, title: 'T', url: 'https://a.com' })
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com', windowId: undefined, active: false })
    expect(chrome.tabGroups.query).not.toHaveBeenCalled()
  })

  it('no-ops grouping on browsers without chrome.tabGroups (Firefox)', async () => {
    vi.stubGlobal('chrome', {
      tabs: { create: vi.fn().mockResolvedValue({ id: 1, windowId: 1 }) },
    })
    await openTabInChromeGroup({ id: 1, title: 'T', url: 'https://a.com', chromeGroup: { id: 0, name: 'G', color: 'blue' } })
    expect(chrome.tabs.create).toHaveBeenCalled()
  })

  it('reuses an existing chrome tab group with the same title', async () => {
    ;(chrome.tabGroups.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 7 }])
    await openTabInChromeGroup(
      { id: 1, title: 'T', url: 'https://a.com', chromeGroup: { id: 7, name: 'Work', color: 'blue' } },
      10,
      true
    )
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://a.com', windowId: 10, active: true })
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [5], groupId: 7 })
    expect(chrome.tabGroups.update).not.toHaveBeenCalled()
  })

  it('creates a new chrome tab group and sets its title/color when none exists', async () => {
    await openTabInChromeGroup({ id: 1, title: 'T', url: 'https://a.com', chromeGroup: { id: 0, name: 'Work', color: 'blue' } })
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [5], createProperties: { windowId: 10 } })
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(99, { title: 'Work', color: 'blue' })
  })
})

describe('openTabInChromeGroup — stored URLs', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: { create: vi.fn().mockResolvedValue({ id: 5, windowId: 10 }), group: vi.fn().mockResolvedValue(99) },
      tabGroups: { query: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', ''])('opens nothing and makes no tab group for the URL %j', async (url) => {
    await openTabInChromeGroup({ id: 0, title: 'T', url, chromeGroup: { id: 1, name: 'Work', color: 'blue' } }, 10, true)
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(chrome.tabs.group).not.toHaveBeenCalled()
  })

  it('still opens a browser page such as chrome://extensions/', async () => {
    await openTabInChromeGroup({ id: 0, title: 'T', url: 'chrome://extensions/' })
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://extensions/', windowId: undefined, active: false })
  })
})
