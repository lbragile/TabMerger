import Anthropic from '@anthropic-ai/sdk'

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

  return JSON.parse(jsonMatch[0]) as TabGroup[]
}

export async function nameGroup(tabs: Tab[]): Promise<string> {
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
  return content.text.trim()
}

export async function summarizeTab(tab: Tab): Promise<string> {
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

export async function suggestSessions(
  groups: { name: string; tabs: Tab[] }[]
): Promise<string> {
  const message = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Based on these tab groups, suggest how the user could organize their browsing sessions for better productivity. Be specific and actionable.\n\n${JSON.stringify(groups, null, 2)}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
}
