interface Tab { id: number; title?: string; url?: string; favIconUrl?: string }
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

  if (bundle.groups.length === 0) {
    return <p className="text-muted-foreground">No groups in this bundle.</p>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{totalTabs} tabs across {bundle.groups.length} groups</p>
      {bundle.groups.map((group) => (
        <div key={group.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full inline-block flex-shrink-0"
              style={{ backgroundColor: group.color }}
            />
            <h2 className="font-semibold text-sm">{group.name}</h2>
          </div>
          {group.windows.map((win) => (
            <div key={win.id} className="ml-5 rounded-md border bg-card divide-y">
              {win.tabs.map((tab) => (
                <a
                  key={tab.id}
                  href={tab.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  {tab.favIconUrl && (
                    // ponytail: no onerror fallback — broken favicons just disappear
                    <img src={tab.favIconUrl} alt="" className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="truncate">{tab.title ?? tab.url}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
