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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {totalTabs} tabs across {totalWindows} windows in {bundle.groups.length} groups
      </p>
      {bundle.groups.map((group) => {
        const groupTabs = group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
        return (
        <div key={group.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full inline-block flex-shrink-0"
              style={{ backgroundColor: group.color }}
            />
            <h2 className="font-semibold text-sm">{group.name}</h2>
            <span className="text-xs text-muted-foreground">
              {group.windows.length} windows &middot; {groupTabs} tabs
            </span>
          </div>
          {group.windows.map((win, winIndex) => (
            <div key={`${group.id}-win-${winIndex}`} className="ml-5 rounded-md border bg-card divide-y">
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                <span>Window {winIndex + 1}</span>
                {win.incognito && (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium">Incognito</span>
                )}
              </div>
              {win.tabs.map((tab, tabIndex) => {
                const href = safeUrl(tab.url)
                const favicon = safeUrl(tab.favIconUrl)
                const key = `${group.id}-win-${winIndex}-tab-${tabIndex}`
                const inner = (
                  <>
                    {favicon && <img src={favicon} alt="" className="w-4 h-4 flex-shrink-0" />}
                    <span className="truncate">{tab.title ?? tab.url}</span>
                  </>
                )
                return href ? (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                    {inner}
                  </a>
                ) : (
                  <span key={key} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    {inner}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        )
      })}
    </div>
  )
}
