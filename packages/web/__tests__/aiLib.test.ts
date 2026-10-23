/**
 * Tests for lib/ai.ts: each task's prompt data and answer parsing, the organize proposal
 * sanitizer, Anthropic error mapping, and how `runAiTask` reads a model response. The SDK
 * client is a plain stand-in passed to `runAiTask`; metering through the routes is covered in
 * `ai-metering.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_GROUP_COLOR, PRESET_COLORS } from '@tabmerger/shared'
import {
  AiRouteError,
  groupTabsTask,
  mapAnthropicError,
  nameGroupTask,
  organizeTask,
  runAiTask,
  sanitizeOrganizeProposal,
  suggestSessionsTask,
  tabSummaryTask,
  type AnthropicClient,
  type OrganizePromptGroup,
} from '@/lib/ai'
import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_RENAME_LENGTH } from '@/lib/ai-validation'

const TABS = [{ id: 1, title: 'React docs', url: 'https://react.dev' }]

describe('groupTabsTask', () => {
  const SENT = [
    { id: 1, title: 'React docs', url: 'https://react.dev' },
    { id: 2, title: 'Vue docs', url: 'https://vuejs.org' },
    { id: 3, title: 'Shoes', url: 'https://shop.example' },
  ]
  const parse = (groups: unknown) => groupTabsTask(SENT).parse({ groups })
  const RED = PRESET_COLORS[0]
  const BLUE = PRESET_COLORS[5]

  it('sends ids, titles and urls, and allows only preset colours', () => {
    const task = groupTabsTask(SENT)
    expect(task.data).toEqual({ tabs: SENT })
    const schema = task.schema as { properties: { groups: { items: { properties: { color: { enum: string[] } } } } } }
    expect(schema.properties.groups.items.properties.color.enum).toEqual([...PRESET_COLORS])
  })

  it('grows the answer budget with the tab count', () => {
    expect(groupTabsTask(SENT).answerTokens).toBeLessThan(
      groupTabsTask(Array.from({ length: 500 }, (_, i) => ({ id: i, title: 't', url: 'https://e.com' }))).answerTokens
    )
  })

  it('keeps only tab ids that were sent', () => {
    expect(parse([{ name: 'Dev', color: RED, tabIds: [1, 99, '2', null, 2] }])).toEqual([
      { name: 'Dev', color: RED, tabIds: [1, 2] },
    ])
  })

  it('places each tab in at most one group and drops groups left empty', () => {
    expect(
      parse([
        { name: 'Dev', color: RED, tabIds: [1, 2, 1] },
        { name: 'Again', color: BLUE, tabIds: [1, 2] },
        { name: 'Shop', color: BLUE, tabIds: [2, 3] },
      ])
    ).toEqual([
      { name: 'Dev', color: RED, tabIds: [1, 2] },
      { name: 'Shop', color: BLUE, tabIds: [3] },
    ])
  })

  it('drops entries that are not groups', () => {
    expect(parse([null, 'Dev', 7, { name: 5, tabIds: [1] }, { name: 'No ids' }, { name: 'Ok', color: RED, tabIds: [3] }])).toEqual([
      { name: 'Ok', color: RED, tabIds: [3] },
    ])
  })

  it('falls back to the default colour for anything that is not a colour, and bounds the name', () => {
    const longName = 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH + 20)
    expect(
      parse([
        { name: longName, tabIds: [1] },
        { name: 'Two', color: 42, tabIds: [2] },
        { name: 'Three', color: 'red; background:url(x)', tabIds: [3] },
      ])
    ).toEqual([
      { name: 'N'.repeat(AI_MAX_GROUP_NAME_LENGTH), color: DEFAULT_GROUP_COLOR, tabIds: [1] },
      { name: 'Two', color: DEFAULT_GROUP_COLOR, tabIds: [2] },
      { name: 'Three', color: DEFAULT_GROUP_COLOR, tabIds: [3] },
    ])
  })

  it('keeps a hex or rgb colour and removes invisible characters from names', () => {
    expect(parse([{ name: 'De​v‮', color: '#3b82f6', tabIds: [1] }])).toEqual([
      { name: 'Dev', color: '#3b82f6', tabIds: [1] },
    ])
  })

  it('returns no groups for a malformed answer', () => {
    expect(groupTabsTask(SENT).parse(null)).toEqual([])
    expect(groupTabsTask(SENT).parse({ groups: 'x' })).toEqual([])
  })
})

describe('nameGroupTask', () => {
  const parse = (name: unknown) => nameGroupTask(TABS).parse({ name })

  it('returns the cleaned name', () => {
    expect(parse('  Research Tabs  ')).toBe('Research Tabs')
  })

  it('flattens a multi-line answer and cuts it to 30 characters', () => {
    const result = parse(`Research\nTabs ${'x'.repeat(500)}`)
    expect(result.startsWith('Research Tabs x')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(AI_MAX_RENAME_LENGTH)
  })

  it('strips surrounding quotes', () => {
    expect(parse('"Dev Tools"')).toBe('Dev Tools')
  })

  it('returns an empty name for a malformed answer', () => {
    expect(parse(42)).toBe('')
  })
})

describe('tabSummaryTask', () => {
  it('sends only the title and url and returns the cleaned summary', () => {
    const task = tabSummaryTask({ title: 'React docs', url: 'https://react.dev' })
    expect(task.data).toEqual({ tab: { title: 'React docs', url: 'https://react.dev' } })
    expect(task.parse({ summary: ' A React documentation page.⁦ ' })).toBe('A React documentation page.')
  })
})

describe('suggestSessionsTask', () => {
  const GROUPS = [
    { id: 'g1', name: 'Dev', tabs: TABS },
    { id: 'g2', name: 'Shopping', tabs: TABS },
  ]
  const parse = (output: unknown) => suggestSessionsTask(GROUPS).parse(output)

  it('never shows the model group ids', () => {
    expect(JSON.stringify(suggestSessionsTask(GROUPS).data)).not.toContain('g1')
  })

  it('maps flagged group names back to their ids', () => {
    expect(parse({ message: '  Archive these.  ', staleGroups: ['Shopping'] })).toEqual({
      message: 'Archive these.',
      staleGroupIds: ['g2'],
    })
  })

  it('matches names case- and whitespace-insensitively and dedupes', () => {
    expect(parse({ message: 'x', staleGroups: [' dev ', 'DEV', 'Dev'] }).staleGroupIds).toEqual(['g1'])
  })

  it('drops hallucinated group names and non-strings', () => {
    expect(parse({ message: 'x', staleGroups: ['Nonexistent', 42, null, 'g1'] }).staleGroupIds).toEqual([])
  })

  it('tolerates a missing or invalid staleGroups field', () => {
    expect(parse({ message: 'x' })).toEqual({ message: 'x', staleGroupIds: [] })
  })

  it('returns an empty message when the model sends a non-string one', () => {
    expect(parse({ message: { text: 'x' }, staleGroups: ['Dev'] })).toEqual({ message: '', staleGroupIds: ['g1'] })
  })

  it('bounds the length of the message', () => {
    expect(parse({ message: 'm'.repeat(1000), staleGroups: [] }).message).toHaveLength(200)
  })
})

describe('organize proposal', () => {
  const GROUPS: OrganizePromptGroup[] = [
    { id: 'now', name: 'Now Open', permanent: true, tabs: [] },
    { id: 'g1', name: 'Work', permanent: false, tabs: [] },
    { id: 'g2', name: 'Work 2', permanent: false, tabs: [] },
  ]

  it('sends id, name, permanent and tabs for each group', () => {
    expect(organizeTask(GROUPS).data).toEqual({ groups: GROUPS })
  })

  it('keeps well-formed actions on sent, non-permanent groups', () => {
    const raw = {
      actions: [
        { type: 'merge', sourceGroupId: 'g2', targetGroupId: 'g1' },
        { type: 'rename', groupId: 'g1', newName: 'Office Work' },
        { type: 'delete', groupId: 'g2' },
        { type: 'reorder', groupIds: ['now', 'g2', 'g1', 'g1'] },
      ],
      rationale: 'Merge the two work groups.',
    }
    expect(sanitizeOrganizeProposal(raw, GROUPS)).toEqual({
      actions: [
        { type: 'merge', sourceGroupId: 'g2', targetGroupId: 'g1' },
        { type: 'rename', groupId: 'g1', newName: 'Office Work' },
        { type: 'delete', groupId: 'g2' },
        { type: 'reorder', groupIds: ['now', 'g2', 'g1'] },
      ],
      rationale: 'Merge the two work groups.',
    })
  })

  it.each([
    ['a permanent group deleted', { type: 'delete', groupId: 'now' }],
    ['a permanent group renamed', { type: 'rename', groupId: 'now', newName: 'X' }],
    ['a group merged into the permanent one', { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'now' }],
    ['an invented id', { type: 'delete', groupId: 'invented' }],
    ['a merge into itself', { type: 'merge', sourceGroupId: 'g1', targetGroupId: 'g1' }],
    ['an empty rename', { type: 'rename', groupId: 'g1', newName: '​ ' }],
    ['an unknown type', { type: 'archive', groupId: 'g1' }],
    ['a reorder of unknown ids only', { type: 'reorder', groupIds: ['x', 'y'] }],
  ])('drops %s', (_label, action) => {
    expect(sanitizeOrganizeProposal({ actions: [action], rationale: '' }, GROUPS).actions).toEqual([])
  })

  it('cuts a rename to the rename limit', () => {
    const { actions } = sanitizeOrganizeProposal(
      { actions: [{ type: 'rename', groupId: 'g1', newName: 'N'.repeat(100) }], rationale: '' },
      GROUPS
    )
    expect(actions).toEqual([{ type: 'rename', groupId: 'g1', newName: 'N'.repeat(AI_MAX_RENAME_LENGTH) }])
  })

  it('returns no actions for a malformed answer', () => {
    expect(sanitizeOrganizeProposal('nope', GROUPS)).toEqual({ actions: [], rationale: '' })
  })
})

describe('mapAnthropicError', () => {
  const err = (props: Record<string, unknown>) => Object.assign(new Error('x'), props)

  it.each([
    [{ status: 401 }, 400, 'byok_key_invalid'],
    [{ status: 403 }, 400, 'byok_key_invalid'],
    [{ status: 402 }, 402, 'byok_billing'],
    [{ status: 400, error: { type: 'error', error: { type: 'billing_error' } } }, 402, 'byok_billing'],
    [{ status: 429 }, 503, 'byok_rate_limited'],
    [{ status: 404 }, 400, 'ai_model_invalid'],
    [{ status: 529 }, 503, 'ai_overloaded'],
    [{ status: 500 }, 503, 'ai_overloaded'],
    [{ status: 400 }, 500, 'ai_failed'],
  ])('BYOK %j → %i %s', (props, status, code) => {
    const mapped = mapAnthropicError(err(props), 'byok')
    expect([mapped.status, mapped.code]).toEqual([status, code])
    expect(mapped.status).not.toBe(401)
    expect(mapped.status).not.toBe(429)
  })

  it.each([
    [{ status: 429 }, 503, 'ai_overloaded'],
    [{ status: 529 }, 503, 'ai_overloaded'],
    [{ name: 'APIConnectionError' }, 503, 'ai_overloaded'],
    [{ status: 401 }, 500, 'ai_failed'],
    [{ status: 400 }, 500, 'ai_failed'],
  ])('managed %j → %i %s', (props, status, code) => {
    const mapped = mapAnthropicError(Object.assign(new Error('x'), props), 'managed')
    expect([mapped.status, mapped.code]).toEqual([status, code])
  })

  it('passes an AiRouteError through', () => {
    const e = new AiRouteError(429, 'ai_quota_exceeded')
    expect(mapAnthropicError(e, 'managed')).toBe(e)
  })
})

describe('runAiTask response handling (unmetered)', () => {
  function clientReturning(response: unknown): AnthropicClient {
    return {
      messages: { create: vi.fn(async () => response), countTokens: vi.fn() },
    } as unknown as AnthropicClient
  }
  const ctx = (client: AnthropicClient) => ({ client, model: 'claude-haiku-5-5' as const, mode: 'byok' as const, meter: null })
  const usage = { input_tokens: 10, output_tokens: 5 }

  it('reads text blocks only, skipping thinking blocks', async () => {
    const client = clientReturning({
      stop_reason: 'end_turn',
      usage,
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"name":"Dev Tools"}' },
      ],
    })
    expect(await runAiTask(nameGroupTask(TABS), ctx(client))).toEqual({ result: 'Dev Tools', remaining: null })
  })

  it('fails with ai_failed on output that is not JSON', async () => {
    const client = clientReturning({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Dev Tools' }] })
    await expect(runAiTask(nameGroupTask(TABS), ctx(client))).rejects.toMatchObject({ status: 502, code: 'ai_failed' })
  })

  it('fails with ai_refused on a refusal', async () => {
    const client = clientReturning({ stop_reason: 'refusal', usage, content: [] })
    await expect(runAiTask(nameGroupTask(TABS), ctx(client))).rejects.toMatchObject({ status: 422, code: 'ai_refused' })
  })

  it('does not count tokens or meter in BYOK mode', async () => {
    const client = clientReturning({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '{"name":"X"}' }] })
    await runAiTask(nameGroupTask(TABS), ctx(client))
    expect(client.messages.countTokens).not.toHaveBeenCalled()
  })
})
