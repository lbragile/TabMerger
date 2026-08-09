/**
 * Tests for lib/ai.ts — thin wrapper around the Anthropic SDK.
 * The SDK itself is mocked; these tests cover our response-parsing logic
 * (text-content extraction, JSON-array extraction, error paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

function textMessage(text: string) {
  return { content: [{ type: 'text', text }] }
}

const TABS = [{ id: 1, title: 'React docs', url: 'https://react.dev' }]

describe('lib/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  it('groupTabs parses a JSON array out of the response text', async () => {
    mockCreate.mockResolvedValue(
      textMessage('Here you go:\n[{"name":"Dev","color":"red","tabIds":[1]}]')
    )
    const { groupTabs } = await import('@/lib/ai')
    const result = await groupTabs(TABS)
    expect(result).toEqual([{ name: 'Dev', color: 'red', tabIds: [1] }])
  })

  it('groupTabs throws when no JSON array is found', async () => {
    mockCreate.mockResolvedValue(textMessage('no json here'))
    const { groupTabs } = await import('@/lib/ai')
    await expect(groupTabs(TABS)).rejects.toThrow('No JSON array found')
  })

  it('groupTabs throws on a non-text content block', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image' }] })
    const { groupTabs } = await import('@/lib/ai')
    await expect(groupTabs(TABS)).rejects.toThrow('Unexpected response type')
  })

  it('nameGroup returns the trimmed text response', async () => {
    mockCreate.mockResolvedValue(textMessage('  Research Tabs  '))
    const { nameGroup } = await import('@/lib/ai')
    const result = await nameGroup(TABS)
    expect(result).toBe('Research Tabs')
  })

  it('summarizeTab returns the trimmed text response', async () => {
    mockCreate.mockResolvedValue(textMessage('A React documentation page.'))
    const { summarizeTab } = await import('@/lib/ai')
    const result = await summarizeTab(TABS[0])
    expect(result).toBe('A React documentation page.')
  })

  describe('suggestSessions', () => {
    const GROUPS = [
      { id: 'g1', name: 'Dev', tabs: TABS },
      { id: 'g2', name: 'Shopping', tabs: TABS },
    ]

    it('maps flagged group names back to their ids', async () => {
      mockCreate.mockResolvedValue(
        textMessage('{"message":"  Archive these.  ","staleGroups":["Shopping"]}')
      )
      const { suggestSessions } = await import('@/lib/ai')
      expect(await suggestSessions(GROUPS)).toEqual({
        message: 'Archive these.',
        staleGroupIds: ['g2'],
      })
    })

    it('matches names case- and whitespace-insensitively and dedupes', async () => {
      mockCreate.mockResolvedValue(
        textMessage('{"message":"x","staleGroups":[" dev ","DEV","Dev"]}')
      )
      const { suggestSessions } = await import('@/lib/ai')
      expect((await suggestSessions(GROUPS)).staleGroupIds).toEqual(['g1'])
    })

    it('drops hallucinated group names and non-strings', async () => {
      mockCreate.mockResolvedValue(
        textMessage('Sure:\n{"message":"x","staleGroups":["Nonexistent",42,null,"g1"]}')
      )
      const { suggestSessions } = await import('@/lib/ai')
      expect((await suggestSessions(GROUPS)).staleGroupIds).toEqual([])
    })

    it('tolerates a missing/invalid staleGroups field', async () => {
      mockCreate.mockResolvedValue(textMessage('{"message":"x"}'))
      const { suggestSessions } = await import('@/lib/ai')
      expect(await suggestSessions(GROUPS)).toEqual({ message: 'x', staleGroupIds: [] })
    })

    it('throws when no JSON object is found', async () => {
      mockCreate.mockResolvedValue(textMessage('no json here'))
      const { suggestSessions } = await import('@/lib/ai')
      await expect(suggestSessions(GROUPS)).rejects.toThrow('No JSON object found')
    })

    it('throws on a non-text content block', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'image' }] })
      const { suggestSessions } = await import('@/lib/ai')
      await expect(suggestSessions(GROUPS)).rejects.toThrow('Unexpected response type')
    })
  })
})
