# AI Features

All AI features are **Pro AI tier only** ($7.99/mo or $69.99/yr). The Claude API is called
server-side via Next.js API routes in `packages/web/app/api/ai/`. The extension sends the
Supabase JWT with every request; the server validates it before calling Claude.

## Model Selection

| Use case | Model | Reasoning |
|---|---|---|
| Tab preview summary | `claude-haiku-4-5-20251001` | Called on hover — latency < 500ms target |
| Group naming | `claude-haiku-4-5-20251001` | Simple task, cheap, fast |
| Auto-grouping | `claude-haiku-4-5-20251001` | Called on-demand, batch of tabs |
| Session suggestions | `claude-haiku-4-5-20251001` | Background, not latency-sensitive |
| Future: quality tasks | `claude-sonnet-4-6` | Only if haiku quality is insufficient |

---

## Feature Specs

### 1. Auto-Group Tabs (`/api/ai/group-tabs`)

**Trigger:** User clicks "AI Group" button in extension header (Pro AI only).

**Input:**
```typescript
{ tabs: Array<{ id: number; title: string; url: string }> }
```

**Output:**
```typescript
{ groups: Array<{ name: string; color: string; tabIds: number[] }> }
```

**Behavior:**
1. All currently open tabs sent to API
2. Claude clusters them into 2-8 logical groups by topic/domain
3. Each tab appears in exactly one group
4. Returned groups are applied to TabMerger (creates new groups, moves tabs)
5. User can undo with Ctrl+Z (entire operation is a single undo step)

**Current prompt (in `packages/web/lib/ai.ts`):**
```
Group these browser tabs into logical categories. Return JSON only. No explanation.

Schema: { "groups": [{ "name": "string (2-4 words)", "color": "rgba(R,G,B,1)", "tabIds": [numbers] }] }
Use these colors: [PRESET_COLORS list]

Tabs:
[JSON array of tabs]
```

**Temperature:** 0.3 (consistent grouping)
**Max tokens:** 1024

---

### 2. Group Name Suggestion (`/api/ai/name-group`)

**Trigger:** User clicks ✨ icon next to group name input field.

**Input:**
```typescript
{ tabs: Array<{ title: string; url: string }> }
```

**Output:**
```typescript
{ name: string }  // 2-4 words, title case, max 30 chars
```

**Examples of good names:** "Dev Tools", "Shopping", "Work Research", "YouTube Queue"

**Current prompt:**
```
Suggest a short 2-4 word name (title case, max 30 characters) for a browser tab group
containing these tabs. Return JSON only: { "name": "..." }

Examples: "Dev Tools", "Shopping", "Work Research"

Tabs: [list]
```

**Temperature:** 0.5
**Max tokens:** 64

---

### 3. Tab Preview on Hover (`/api/ai/tab-summary`)

**Trigger:** Hovering over a tab title in the extension for 400ms (debounced).

**Input:**
```typescript
{ url: string; title: string }
```

**Output:**
```typescript
{ summary: string }  // 1-2 sentences, max 60 words
```

**Behavior:**
- Inferred from URL + title only — no web scraping
- Shows in a Popover tooltip next to the tab title
- Shows skeleton while loading; fades in on arrival
- Cached in IndexedDB by URL for 24 hours

**Current prompt:**
```
In 1-2 sentences (max 60 words), describe what this web page is likely about
based on its URL and title. Be factual, not speculative.

Title: [title]
URL: [url]
```

**Temperature:** 0.2
**Max tokens:** 128

---

### 4. Smart Session Suggestions (`/api/ai/suggest-sessions`)

**Trigger:** Called periodically by background service worker (every 30 min when active).

**Input:**
```typescript
{ recentGroups: Group[] }  // last 5-10 groups with their tab structure
```

**Output:**
```typescript
{ suggestion: string }  // natural language, max 100 chars
```

**Example outputs:**
- "You often open Research + Dev Tools together — save as a session?"
- "These 12 tabs are getting heavy — want to save and close some?"

**Behavior:**
- Shown as a subtle dismissible banner in extension header
- Clicking "Save" opens the session save modal pre-filled
- Not shown if user dismissed in the last 24h

**Temperature:** 0.7
**Max tokens:** 128

---

## Manual QA Checklist

Sign in as a `pro_ai` account, open the popup (right-click → Inspect to get DevTools), trigger
each action below, and confirm a 200 response with the expected shape (not 403/429).

| Feature | Trigger | Where to look |
|---|---|---|
| Auto-group (`useAutoGroup`) | Select tabs → "AI Auto-group" in Header | Groups get created/renamed; watch Network tab for `POST /api/ai/group-tabs` |
| Name group (`useNameGroup`) | Right-click a group → AI rename (if wired) | Group title updates; `POST /api/ai/name-group` |
| Suggest sessions (`useSuggestSessions`) | Automatic, once/day, on popup open (Pro AI) | Purple banner at top of popup; `POST /api/ai/suggest-sessions` |
| Organize tabs (`useOrganizeTabs`) | Settings → Organize | `POST /api/ai/organize`, returns `{ runId, token }` |
| Tab summary (`useTabSummary`) | Hover a tab | Tooltip text; `POST /api/ai/tab-summary` |

**Quota metering:** after each call, check the `ai_usage` row for that user in Supabase —
`remaining` should decrement (also visible via the `X-AI-Requests-Remaining` response header).

**Quota-exceeded path:** either exhaust the monthly cap for real, or temporarily lower
`AI_MONTHLY_CAP` in `packages/web/lib/ai-usage.ts` locally, then confirm `AIQuotaExceededPrompt`
renders in place of a generic error (extension side: `packages/extension/src/components/AIQuotaExceededPrompt.tsx`).

---

## Security Architecture

Every AI route follows this exact security check order:

```typescript
// 1. Extract and validate JWT
const token = req.headers.get('Authorization')?.replace('Bearer ', '');
if (!token) return 401;

const supabase = createServiceRoleClient(); // bypasses RLS
const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) return 401;

// 2. Check subscription (BOTH tier AND status)
const { data: sub } = await supabase
  .from('subscriptions')
  .select('tier, status')
  .eq('user_id', user.id)
  .single();

if (sub?.tier !== 'pro_ai' || sub?.status !== 'active') return 403;

// 3. Call Claude
```

---

## Cost Estimates

Approximate costs at scale (haiku pricing as of 2025):
- Input: ~$0.25 / 1M tokens
- Output: ~$1.25 / 1M tokens

| Feature | Avg input tokens | Avg output tokens | Cost per call |
|---|---|---|---|
| Auto-group (20 tabs) | ~500 | ~300 | ~$0.0005 |
| Name group (5 tabs) | ~150 | ~20 | ~$0.00006 |
| Tab summary | ~80 | ~60 | ~$0.0001 |
| Session suggestion | ~800 | ~40 | ~$0.0002 |

At 500 Pro AI users making 10 tab summary calls/day: ~$0.50/day = $15/month.
Cost is negligible relative to revenue at target scale.

---

## Planned AI Improvements (v2.2)

- [ ] Few-shot examples in auto-grouping prompt (improves cluster quality)
- [ ] Tab summary caching by URL (24h TTL) — eliminates 80%+ of API calls
- [ ] Streaming for session suggestions (show text as it types)
- [ ] Deduplication: cluster near-identical URLs into one tab entry
- [ ] Smart close: flag tabs inactive for 3+ days
- [ ] Quality logging: store AI inputs/outputs in Supabase for manual review
