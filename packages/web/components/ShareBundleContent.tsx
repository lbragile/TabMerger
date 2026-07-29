'use client'

interface Tab { id: number; title?: string; url?: string; favIconUrl?: string }

function safeUrl(u?: string): string | undefined {
  if (!u) return undefined
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : undefined
  } catch { return undefined }
}
interface ExtWindow { id: number; tabs: Tab[]; incognito: boolean; focused: boolean }
interface Group { id: string; name: string; color: string; windows: ExtWindow[] }

// ponytail: sequential window.open() calls inside a click handler are fine — most browsers
// allow several tabs per user gesture; no queue/throttle infra needed for a share page.
function windowUrls(win: ExtWindow): string[] {
  return win.tabs.map((t) => safeUrl(t.url)).filter((u): u is string => !!u)
}
function groupUrls(group: Group): string[] {
  return group.windows.flatMap(windowUrls)
}

interface Bundle {
  slug: string
  expiresAt?: string | null
  groups: Group[]
}

export function ShareBundleContent({ bundle }: { bundle: Bundle | null }) {
  if (!bundle) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        <p>Link not found.</p>
      </div>
    )
  }

  if (bundle.expiresAt && new Date(bundle.expiresAt) < new Date()) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        <p>Link expired.</p>
      </div>
    )
  }

  const totalTabs = bundle.groups.reduce(
    (sum, g) => sum + g.windows.reduce((ws, w) => ws + w.tabs.length, 0),
    0
  )
  const totalWindows = bundle.groups.reduce((sum, g) => sum + g.windows.length, 0)

  if (bundle.groups.length === 0) {
    return <p className="text-muted-foreground">No groups in this bundle.</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text2">
        {totalTabs} tabs across {totalWindows} windows in {bundle.groups.length} groups
      </p>
      {bundle.groups.map((group) => {
        const groupTabs = group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
        return (
        <div key={group.id} className="rounded-[14px] border border-border bg-surface overflow-hidden shadow-sh1">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line bg-surface2">
            <span
              className="w-[7px] h-6 rounded-[4px] inline-block flex-shrink-0"
              style={{ backgroundColor: group.color }}
            />
            <h2 className="font-semibold text-[15px]">{group.name}</h2>
            <span className="text-xs text-text3">
              {group.windows.length} windows &middot; {groupTabs} tabs
            </span>
            <button
              type="button"
              aria-label={group.windows.length === 1 ? 'Open window' : 'Open all windows'}
              className="ml-auto text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              disabled={groupUrls(group).length === 0}
              onClick={() => groupUrls(group).forEach((url) => window.open(url, '_blank'))}
            >
              {group.windows.length === 1 ? 'Open window' : 'Open all windows'}
            </button>
          </div>
          <div className="p-2 flex flex-col gap-2">
          {group.windows.map((win, winIndex) => (
            <div key={`${group.id}-win-${winIndex}`} className="rounded-[9px] border border-line divide-y divide-line">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-text3">
                <span>Window {winIndex + 1}</span>
                {win.incognito && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium">Incognito</span>
                )}
                <button
                  type="button"
                  aria-label={windowUrls(win).length === 1 ? 'Open tab' : 'Open all tabs'}
                  className="ml-auto text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                  disabled={windowUrls(win).length === 0}
                  onClick={() => windowUrls(win).forEach((url) => window.open(url, '_blank'))}
                >
                  {windowUrls(win).length === 1 ? 'Open tab' : 'Open all tabs'}
                </button>
              </div>
              {win.tabs.map((tab, tabIndex) => {
                const href = safeUrl(tab.url)
                const favicon = safeUrl(tab.favIconUrl)
                const key = `${group.id}-win-${winIndex}-tab-${tabIndex}`
                let hostname = ''
                if (href) {
                  try { hostname = new URL(href).hostname.replace(/^www\./, '') } catch { /* noop */ }
                }
                const inner = (
                  <>
                    {favicon ? (
                      <span className="h-[18px] w-[18px] flex-shrink-0 overflow-hidden rounded-[5px] border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 flex items-center justify-center">
                        <img src={favicon} alt="" className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="h-[18px] w-[18px] flex-shrink-0 rounded-[5px] bg-surface3" />
                    )}
                    <span className="flex-1 min-w-0 truncate">{tab.title ?? tab.url}</span>
                    {hostname && (
                      <span className="flex items-center gap-1.5 shrink-0 min-w-0">
                        <span aria-hidden="true" className="text-text3">&#9670;</span>
                        <span className="font-mono text-[11.5px] text-text3 truncate max-w-[160px]">{hostname}</span>
                      </span>
                    )}
                  </>
                )
                return href ? (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-surface2 transition-colors">
                    {inner}
                  </a>
                ) : (
                  <span key={key} className="flex items-center gap-2.5 px-3 py-2 text-sm text-text3">
                    {inner}
                  </span>
                )
              })}
            </div>
          ))}
          </div>
        </div>
        )
      })}
    </div>
  )
}
