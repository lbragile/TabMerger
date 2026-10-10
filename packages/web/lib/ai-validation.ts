import { z } from 'zod'
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

/**
 * Request-body validation shared by every `/api/ai/*` route.
 *
 * Each `parse*Body` helper takes the already-JSON-parsed body (see {@link readJsonBody})
 * and returns either sanitized data or the 400 error message for that route. The
 * sanitized data holds only the fields the prompts use: unknown keys are dropped,
 * over-long text is truncated and control characters are flattened to spaces.
 *
 * Text is truncated rather than rejected, because titles and URLs come from web
 * pages and no client-side limit applies to them. Requests are rejected only for
 * wrong types, missing or empty arrays, and counts above a ceiling.
 */

// --- Limits -----------------------------------------------------------------
// These are candidates for `@tabmerger/shared` constants so the extension can
// show the same ceilings before sending a request.

/** Tab titles longer than this are truncated. The prompts only need the gist of a title. */
export const AI_MAX_TITLE_LENGTH = 300

/** URLs longer than this are truncated. Host, path and the leading query carry the topic. */
export const AI_MAX_URL_LENGTH = 500

/** Group names longer than this are truncated. */
export const AI_MAX_GROUP_NAME_LENGTH = 100

/** Longest accepted group id. Ids are nanoid(10) locally and UUIDs (36) for stored rows. */
export const AI_MAX_ID_LENGTH = 64

/**
 * Most tabs accepted in one list (a group-tabs or name-group request, or one group
 * of a suggest-sessions or organize request).
 */
export const AI_MAX_TABS_PER_LIST = 1000

/** Most groups accepted in one suggest-sessions or organize request. */
export const AI_MAX_GROUPS = 500

/**
 * Most tabs accepted across all groups of one request. At typical title and URL
 * lengths this is about what fits in one model request.
 */
export const AI_MAX_TOTAL_TABS = 3000

/** Longest accepted organize hook token. Tokens are `org-<uuid>-<32 hex>`, 73 characters. */
export const AI_MAX_HOOK_TOKEN_LENGTH = 200

/** Most actions accepted in an edited organize proposal. */
export const AI_MAX_ACTIONS = 500

/** Longest group name a rename action may set. Same limit as the workflow's own schema. */
export const AI_MAX_RENAME_LENGTH = 30

/** Highest count the dev-only usage route accepts. */
export const AI_MAX_DEV_USAGE_COUNT = 1_000_000

// --- Text sanitizing --------------------------------------------------------

// `\p{Cc}` is the C0 controls (incl. tab, CR, LF), DEL and the C1 controls; the
// Unicode line and paragraph separators are added because they also break lines.
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]+/gu

/**
 * Makes request text safe to place on a single prompt line: runs of control
 * characters (including line breaks) become one space, the result is trimmed and
 * cut to `max` UTF-16 units without leaving half of a surrogate pair at the end.
 */
export function sanitizePromptText(value: string, max: number): string {
  // Pre-cut so a very long string is not scanned in full. Trimming and collapsing
  // can only shorten it, so a generous window is enough to still fill `max`.
  let text = value.slice(0, max * 4).replace(CONTROL_CHARS, ' ').trim()
  if (text.length > max) {
    text = text.slice(0, max)
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  }
  return text
}

const promptText = (max: number) => z.string().transform((s) => sanitizePromptText(s, max))

// --- Schemas ----------------------------------------------------------------

/** The two tab fields the prompts read. `z.object` drops every other key. */
const promptTabSchema = z.object({
  title: promptText(AI_MAX_TITLE_LENGTH),
  url: promptText(AI_MAX_URL_LENGTH),
})

/** A tab whose id the caller needs back (group-tabs returns tab ids). */
const identifiedTabSchema = promptTabSchema.extend({ id: z.number().int() })

const tabListSchema = z.array(promptTabSchema).max(AI_MAX_TABS_PER_LIST)

const groupTabsBodySchema = z.object({
  tabs: z.array(identifiedTabSchema).min(1).max(AI_MAX_TABS_PER_LIST),
})

const nameGroupBodySchema = z.object({ tabs: tabListSchema.min(1) })

// The extension sends `{ url, title }`; `{ tab: { id, title, url } }` is the
// route's original shape and stays accepted.
const tabSummaryBodySchema = z.union([
  z.object({ tab: identifiedTabSchema }).transform(({ tab }) => ({ title: tab.title, url: tab.url })),
  promptTabSchema,
])

/**
 * The tabs of one group, read tolerantly: a group is still useful to the prompt when
 * one of its tabs is unusual (for example a tab imported without a title). An entry
 * that is not an object or has no string `url` is dropped, and a missing or non-string
 * `title` becomes `''`. The count ceiling applies to the list as sent.
 */
const groupTabListSchema = z
  .array(z.unknown())
  .max(AI_MAX_TABS_PER_LIST)
  .transform((tabs) =>
    tabs.flatMap((tab): PromptTab[] => {
      if (!isRecord(tab) || typeof tab.url !== 'string') return []
      return [
        {
          title: typeof tab.title === 'string' ? sanitizePromptText(tab.title, AI_MAX_TITLE_LENGTH) : '',
          url: sanitizePromptText(tab.url, AI_MAX_URL_LENGTH),
        },
      ]
    })
  )

const groupSchema = z.object({
  id: z.string().min(1).max(AI_MAX_ID_LENGTH),
  name: promptText(AI_MAX_GROUP_NAME_LENGTH),
  tabs: groupTabListSchema,
})

const suggestSessionsBodySchema = z.object({
  groups: z.array(groupSchema).min(1).max(AI_MAX_GROUPS),
})

const organizeGroupSchema = groupSchema.extend({
  // A non-boolean flag is ignored, not an error: the workflow then infers it from the index.
  permanent: z.boolean().optional().catch(undefined),
})

const organizeGroupsSchema = z.array(organizeGroupSchema).min(1).max(AI_MAX_GROUPS)

const groupIdSchema = z.string().min(1).max(AI_MAX_ID_LENGTH)

/** Mirrors `ReorganizeAction`; the `satisfies` below fails the type-check if the two drift. */
const reorganizeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('merge'), sourceGroupId: groupIdSchema, targetGroupId: groupIdSchema }),
  z.object({
    type: z.literal('rename'),
    groupId: groupIdSchema,
    newName: z.string().max(AI_MAX_RENAME_LENGTH),
  }),
  z.object({ type: z.literal('delete'), groupId: groupIdSchema }),
  z.object({ type: z.literal('reorder'), groupIds: z.array(groupIdSchema).max(AI_MAX_GROUPS) }),
]) satisfies z.ZodType<ReorganizeAction>

const approveBodySchema = z.object({
  token: z.string().min(1).max(AI_MAX_HOOK_TOKEN_LENGTH),
  approved: z.boolean(),
  actions: z.array(reorganizeActionSchema).max(AI_MAX_ACTIONS).optional(),
})

const devUsageBodySchema = z.object({
  count: z.number().int().min(0).max(AI_MAX_DEV_USAGE_COUNT),
})

// --- Types ------------------------------------------------------------------

export type PromptTab = z.infer<typeof promptTabSchema>
export type IdentifiedTab = z.infer<typeof identifiedTabSchema>
export type PromptGroup = z.infer<typeof groupSchema>
export type OrganizeGroup = PromptGroup & { permanent: boolean }
export type ApproveBody = z.infer<typeof approveBodySchema>

/** Sanitized data, or the message for the route's `{ error }` 400 response. */
export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string }

const ok = <T>(data: T): ParseResult<T> => ({ ok: true, data })
const fail = (error: string): ParseResult<never> => ({ ok: false, error })

// --- Helpers ----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the request body as JSON without throwing. Returns `undefined` for an
 * empty or malformed body; any other value (including `null`, arrays and
 * primitives) is returned as parsed, for the route's schema to reject.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** The `key` property when `body` is a JSON object holding an array there. */
function arrayAt(body: unknown, key: string): unknown[] | null {
  if (!isRecord(body)) return null
  const value = body[key]
  return Array.isArray(value) ? value : null
}

/** True when a groups array, or the tabs inside it, is above a count ceiling. */
function groupsOverCeiling(groups: unknown[]): boolean {
  if (groups.length > AI_MAX_GROUPS) return true
  let total = 0
  for (const group of groups) {
    const tabs = isRecord(group) && Array.isArray(group.tabs) ? group.tabs : []
    if (tabs.length > AI_MAX_TABS_PER_LIST) return true
    total += tabs.length
    if (total > AI_MAX_TOTAL_TABS) return true
  }
  return false
}

// --- Route parsers ----------------------------------------------------------

/** group-tabs: `{ tabs: { id, title, url }[] }`. */
export function parseGroupTabsBody(body: unknown): ParseResult<IdentifiedTab[]> {
  if ((arrayAt(body, 'tabs')?.length ?? 0) > AI_MAX_TABS_PER_LIST) return fail('too many tabs')
  const parsed = groupTabsBodySchema.safeParse(body)
  return parsed.success ? ok(parsed.data.tabs) : fail('tabs array required')
}

/** name-group: `{ tabs: { title, url }[] }`. */
export function parseNameGroupBody(body: unknown): ParseResult<PromptTab[]> {
  if ((arrayAt(body, 'tabs')?.length ?? 0) > AI_MAX_TABS_PER_LIST) return fail('too many tabs')
  const parsed = nameGroupBodySchema.safeParse(body)
  return parsed.success ? ok(parsed.data.tabs) : fail('tabs array required')
}

/** tab-summary: `{ url, title }`, or `{ tab: { id, title, url } }`. */
export function parseTabSummaryBody(body: unknown): ParseResult<PromptTab> {
  const parsed = tabSummaryBodySchema.safeParse(body)
  return parsed.success ? ok(parsed.data) : fail('tab object required')
}

/**
 * Leaves out every group that was sent with tabs but has none left after the
 * tolerant read (`groupTabListSchema`). Such a group is not empty, only unreadable
 * here, and passing it on with no tabs would present it to the model as an empty
 * group. A group sent with `tabs: []` is genuinely empty and is kept.
 *
 * `parsed` must be the schema output for `sent`, so the two line up by index.
 */
function withoutEmptiedGroups<T extends { tabs: PromptTab[] }>(sent: unknown[], parsed: T[]): T[] {
  return parsed.filter((group, i) => {
    const raw = sent[i]
    const sentTabs = isRecord(raw) && Array.isArray(raw.tabs) ? raw.tabs.length : 0
    return group.tabs.length > 0 || sentTabs === 0
  })
}

/** suggest-sessions: `{ groups: { id, name, tabs }[] }`. */
export function parseSuggestSessionsBody(body: unknown): ParseResult<PromptGroup[]> {
  const groups = arrayAt(body, 'groups')
  if (groups && groupsOverCeiling(groups)) return fail('too many groups or tabs')
  const parsed = suggestSessionsBodySchema.safeParse(body)
  if (!groups || !parsed.success) return fail('groups array required')

  // Same rule as organize: a group whose tabs were all unreadable is left out, so
  // it is not suggested as stale for looking empty.
  const usable = withoutEmptiedGroups(groups, parsed.data.groups)
  return usable.length > 0 ? ok(usable) : fail('no readable tabs in groups')
}

/**
 * organize: an optional `{ groups: { id, name, permanent?, tabs }[] }`.
 *
 * `data` is `null`, which sends the workflow down its stored-rows path, only when
 * no groups were sent: the body is not a JSON object, or `groups` is missing, `null`
 * or an empty array. A payload that is present is never downgraded to `null`,
 * because for an end-to-end encrypted account the stored rows are ciphertext and the
 * client payload is the only readable source. Present groups are either used (with
 * unusual tabs dropped or coerced, see `groupTabListSchema`) or rejected: `groups`
 * that is not an array, a group without a string id, string name and tabs array, an
 * empty or over-long id, or counts above a ceiling.
 *
 * A group that was sent with tabs and has none left after the tolerant read is left
 * out (see `withoutEmptiedGroups`): the workflow's instructions allow removing empty
 * groups, and an approved removal acts on the stored row. If that leaves no groups
 * at all the request is rejected, again never downgraded to `null`. A left-out group
 * takes no slot in a later reorder, so positions after it can be one lower than the
 * client's index; the extension never sends such a group.
 *
 * Every returned group carries an explicit `permanent`: the flag as sent when it is a
 * boolean, otherwise whether the group was first in the array as sent (the
 * extension's list starts with Now Open). It is resolved before groups are left out.
 */
export function parseOrganizeBody(body: unknown): ParseResult<OrganizeGroup[] | null> {
  const groups = isRecord(body) ? body.groups : undefined
  if (groups === undefined || groups === null) return ok(null)
  if (!Array.isArray(groups)) return fail('groups must be an array')
  if (groups.length === 0) return ok(null)
  if (groupsOverCeiling(groups)) return fail('too many groups or tabs')

  const parsed = organizeGroupsSchema.safeParse(groups)
  if (!parsed.success) return fail('invalid groups')

  // Resolve `permanent` against the index in the array as sent, before any group is
  // left out, so a later group can never inherit the index-0 default.
  const resolved: OrganizeGroup[] = parsed.data.map((g, sentIndex) => ({
    id: g.id,
    name: g.name,
    tabs: g.tabs,
    permanent: typeof g.permanent === 'boolean' ? g.permanent : sentIndex === 0,
  }))

  const usable = withoutEmptiedGroups(groups, resolved)
  return usable.length > 0 ? ok(usable) : fail('no readable tabs in groups')
}

/** organize/approve: `{ token, approved, actions? }`. */
export function parseApproveBody(body: unknown): ParseResult<ApproveBody> {
  const parsed = approveBodySchema.safeParse(body)
  return parsed.success ? ok(parsed.data) : fail('token and approved are required')
}

/** dev-usage: `{ count }`. */
export function parseDevUsageBody(body: unknown): ParseResult<number> {
  const parsed = devUsageBodySchema.safeParse(body)
  return parsed.success ? ok(parsed.data.count) : fail('count must be a non-negative integer')
}
