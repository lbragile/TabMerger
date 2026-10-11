import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_GROUP_COLOR } from '@tabmerger/shared'
import { AI_MAX_GROUP_NAME_LENGTH, sanitizePromptText } from '@/lib/ai-validation'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const AI_MODEL = 'claude-haiku-4-5-20251001'

export interface Tab {
  id: number
  title: string
  url: string
}

export interface TabGroup {
  name: string
  color: string
  tabIds: number[]
}

/** The tab fields the prompts read. Routes pass tabs already sanitized by `lib/ai-validation.ts`. */
export type PromptTab = Pick<Tab, 'title' | 'url'>

/** Longest model-written text returned to the client as a color value. */
const MAX_COLOR_LENGTH = 64

/** Longest banner message returned by {@link suggestSessions}; the prompt asks for 100. */
const MAX_SUGGESTION_LENGTH = 200

/**
 * Reduces the model's group list to well-formed groups over the tabs that were sent.
 *
 * Entries that are not `{ name: string, tabIds: unknown[] }` are dropped, as are tab
 * ids that were not in the request and ids already placed in an earlier group, so each
 * sent tab appears in at most one group. Groups left without tabs are dropped. A
 * missing color falls back to the default group color.
 */
export function sanitizeTabGroups(raw: unknown, tabs: Pick<Tab, 'id'>[]): TabGroup[] {
  if (!Array.isArray(raw)) return []

  const unplaced = new Set(tabs.map((t) => t.id))
  const groups: TabGroup[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { name, color, tabIds } = entry as Record<string, unknown>
    if (typeof name !== 'string' || !Array.isArray(tabIds)) continue

    const kept: number[] = []
    for (const id of tabIds) {
      if (typeof id === 'number' && unplaced.delete(id)) kept.push(id)
    }
    if (kept.length === 0) continue

    groups.push({
      name: sanitizePromptText(name, AI_MAX_GROUP_NAME_LENGTH),
      color:
        typeof color === 'string' && color.length > 0 && color.length <= MAX_COLOR_LENGTH
          ? color
          : DEFAULT_GROUP_COLOR,
      tabIds: kept,
    })
  }

  return groups
}

export async function groupTabs(tabs: Tab[]): Promise<TabGroup[]> {
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Group these browser tabs into logical categories. Return JSON only.\n\n${JSON.stringify(tabs, null, 2)}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  const raw = content.text.trim()
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No JSON array found in response')

  return sanitizeTabGroups(JSON.parse(jsonMatch[0]), tabs)
}

export async function nameGroup(tabs: PromptTab[]): Promise<string> {
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Suggest a short, descriptive name (2-4 words) for a browser tab group containing these tabs. Return only the name, no quotes or explanation.\n\n${tabs.map((t) => `- ${t.title}: ${t.url}`).join('\n')}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  // A group name is one short line; anything longer is cut to the group-name limit.
  return sanitizePromptText(content.text, AI_MAX_GROUP_NAME_LENGTH)
}

export async function summarizeTab(tab: PromptTab): Promise<string> {
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Provide a one-sentence summary of what this browser tab is likely about based on its title and URL. Return only the summary.\n\nTitle: ${tab.title}\nURL: ${tab.url}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
}

export interface SessionSuggestion {
  /** Human-readable banner text, max ~100 chars. */
  message: string
  /** `Group.id` values the message is about, so the UI can offer a per-group action. */
  staleGroupIds: string[]
}

/**
 * Suggests how the user could consolidate/archive their groups.
 *
 * The model only ever reasons over group *names* — it is never shown or asked to echo
 * `Group.id`, because model-invented IDs would silently point at the wrong group.
 * The names it flags are mapped back to IDs here from the caller's own input array.
 */
export async function suggestSessions(
  groups: { id: string; name: string; tabs: PromptTab[] }[]
): Promise<SessionSuggestion> {
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Based on these tab groups, suggest how the user could organize their browsing sessions for better productivity. Be specific and actionable.

Also identify which of these groups the suggestion is about — the ones that look stale, redundant, or worth archiving/merging. Refer to them by their exact "name" as given below. Use an empty array if none apply.

Respond with JSON only. No explanation. Schema:
{"message": "<one sentence, max 100 characters>", "staleGroups": ["<exact group name>", ...]}

${JSON.stringify(groups, null, 2)}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  const jsonMatch = content.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON object found in response')

  const parsed = JSON.parse(jsonMatch[0]) as { message?: unknown; staleGroups?: unknown }
  const text = typeof parsed.message === 'string' ? parsed.message : ''
  const flagged = Array.isArray(parsed.staleGroups) ? parsed.staleGroups : []

  const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]))
  const staleGroupIds = [
    ...new Set(
      flagged
        .map((n) => (typeof n === 'string' ? byName.get(n.trim().toLowerCase()) : undefined))
        .filter((id): id is string => Boolean(id))
    ),
  ]

  return { message: sanitizePromptText(text, MAX_SUGGESTION_LENGTH), staleGroupIds }
}
