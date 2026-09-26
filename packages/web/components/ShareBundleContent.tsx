'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { importKeyFromBase64, decryptBlob } from '@tabmerger/shared'
import { useLocationHash } from '@/lib/hooks/useLocationHash'

interface Tab { id: number; title?: string; url?: string; favIconUrl?: string; ogImage?: string }

// ponytail: module-level cache — lives for the page session, cleared on reload
const ogImageCache = new Map<string, string | null>()

async function fetchOgImage(url: string): Promise<string | null> {
  if (ogImageCache.has(url)) return ogImageCache.get(url)!
  try {
    const res = await fetch(`/api/og-preview?url=${encodeURIComponent(url)}`)
    const data = (await res.json()) as { ogImage: string | null }
    ogImageCache.set(url, data.ogImage)
    return data.ogImage
  } catch {
    return null
  }
}

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E"

function truncateUrl(url: string, max = 20): string {
  return url.length > max ? `${url.slice(0, max)}…` : url
}

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

function TabPreviewTooltip({ tab, favicon, row }: { tab: Tab; favicon?: string; row: React.ReactNode }) {
  const [ogImage, setOgImage] = useState<string | null>(tab.ogImage ?? null)
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(false)

  const handleOpenChange = useCallback(async (isOpen: boolean) => {
    if (!isOpen || fetchedRef.current || tab.ogImage || !tab.url) return
    fetchedRef.current = true
    setLoading(true)
    const img = await fetchOgImage(tab.url)
    setOgImage(img)
    setLoading(false)
  }, [tab.ogImage, tab.url])

  return (
    <Tooltip delayDuration={400} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>
        <span className="min-w-0 w-full overflow-hidden block">{row}</span>
      </TooltipTrigger>
      {/* Portal: the tooltip renders at the document root, not inside the group card
          (which is overflow-hidden), so the card can't clip or hide the preview. */}
      <TooltipPrimitive.Portal>
      <TooltipContent
        side="top"
        align="start"
        className="w-72 p-3 bg-popover text-popover-foreground border border-border shadow-md"
      >
        <div className="flex items-start gap-2">
          {/* Arbitrary remote favicon from a shared tab's own site — the source domain is
              unbounded (anyone's bookmarked URL), so next/image's required remotePatterns
              allow-list can't cover it. Plain <img> is the correct call here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={favicon || FALLBACK_FAVICON}
            alt=""
            className="mt-0.5 h-4 w-4 shrink-0"
            onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tab.title}</p>
            <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
            {loading ? (
              <Skeleton className="mt-2 h-24 w-full rounded" />
            ) : ogImage ? (
              // Arbitrary remote OG image fetched live from the tab's own site by
              // /api/og-preview — same unbounded-domain reasoning as the favicon above.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ogImage}
                alt=""
                className="mt-2 w-full rounded object-cover max-h-32"
                // Sites that block hotlinking return an error here: show "No preview"
                // instead of a broken-image icon.
                onError={() => setOgImage(null)}
              />
            ) : (
              <div className="mt-2 h-24 w-full rounded bg-muted flex flex-col items-center justify-center gap-1 text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs opacity-40">No preview</span>
              </div>
            )}
          </div>
        </div>
      </TooltipContent>
      </TooltipPrimitive.Portal>
    </Tooltip>
  )
}

interface EncryptedSnapshot { v: 1; iv: string; ct: string }

interface Bundle {
  slug: string
  expiresAt?: string | null
  groups: Group[] | EncryptedSnapshot
}

function isEncrypted(groups: Group[] | EncryptedSnapshot): groups is EncryptedSnapshot {
  return !Array.isArray(groups)
}

/**
 * Decrypts a per-share {v:1,iv,ct} snapshot using the key embedded in the
 * URL's #key= fragment. Fragments are never sent to the server (not by
 * fetch, not by the initial page request), so this is the only place the
 * key exists — read here, used here, never forwarded anywhere.
 */
function useDecryptedGroups(groups: Group[] | EncryptedSnapshot) {
  const encrypted = isEncrypted(groups)
  // Reading location.hash safely across SSR/hydration — see useLocationHash.
  const hash = useLocationHash()

  const keyB64 = useMemo(() => {
    if (!encrypted) return null
    // ponytail: don't use URLSearchParams here — base64 can contain '+', which
    // URLSearchParams decodes as a space (form-encoding convention), silently
    // corrupting the key whenever the random key happens to contain one.
    const match = hash.slice(1).match(/(?:^|&)key=([^&]*)/)
    return match ? decodeURIComponent(match[1]) : null
  }, [encrypted, hash])

  // Only the genuinely async decrypt result needs React state — the "not encrypted"
  // and "no key in the fragment" cases are derived straight from props/hash below,
  // with no setState-in-effect needed for them.
  const [asyncResult, setAsyncResult] = useState<
    { status: 'done'; groups: Group[] } | { status: 'error' } | null
  >(null)

  useEffect(() => {
    if (!encrypted || !keyB64) return
    let cancelled = false
    ;(async () => {
      try {
        const key = await importKeyFromBase64(keyB64)
        const decrypted = await decryptBlob<Group[]>(key, groups)
        if (!cancelled) setAsyncResult({ status: 'done', groups: decrypted })
      } catch {
        if (!cancelled) setAsyncResult({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [encrypted, keyB64, groups])

  if (!encrypted) return { status: 'plain', groups } as const
  if (!keyB64) return { status: 'error' } as const
  return asyncResult ?? ({ status: 'loading' } as const)
}

export function ShareBundleContent({ bundle }: { bundle: Bundle | null }) {
  // Hooks must run unconditionally — pass a harmless placeholder when there's no bundle.
  const decryptState = useDecryptedGroups(bundle?.groups ?? [])

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

  if (decryptState.status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        <p>Decrypting…</p>
      </div>
    )
  }

  if (decryptState.status === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-muted-foreground">
        <p>Can&apos;t decrypt this link — the key is missing or invalid.</p>
      </div>
    )
  }

  const groups = decryptState.groups

  const totalTabs = groups.reduce(
    (sum, g) => sum + g.windows.reduce((ws, w) => ws + w.tabs.length, 0),
    0
  )
  const totalWindows = groups.reduce((sum, g) => sum + g.windows.length, 0)

  if (groups.length === 0) {
    return <p className="text-muted-foreground">No groups in this bundle.</p>
  }

  return (
    <TooltipProvider>
    <div className="space-y-4">
      <p className="text-sm text-text2">
        {totalTabs} tabs across {totalWindows} windows in {groups.length} groups
      </p>
      {groups.map((group) => {
        const groupTabs = group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
        return (
        <div key={group.id} className="rounded-xl border border-border bg-surface overflow-hidden shadow-sh1">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line bg-surface2">
            <span
              className="w-[7px] h-6 rounded-xs inline-block flex-shrink-0"
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
            <div key={`${group.id}-win-${winIndex}`} className="rounded-sm border border-line divide-y divide-line">
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
                const shortUrl = href ? truncateUrl(href) : ''
                const inner = (
                  <>
                    {/* The icon on its own — no bordered/filled tile around it. Arbitrary remote
                        favicon: same unbounded-domain reasoning as above. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={favicon || FALLBACK_FAVICON}
                      alt=""
                      className="h-4 w-4 flex-shrink-0"
                      onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON }}
                    />
                    <span className="flex-1 min-w-0 truncate">{tab.title ?? tab.url}</span>
                    {shortUrl && (
                      <span className="flex items-center gap-1.5 shrink-0 min-w-0">
                        <span aria-hidden="true" className="text-text3">&#9670;</span>
                        <span className="font-mono text-[11.5px] text-text3" title={href}>{shortUrl}</span>
                      </span>
                    )}
                  </>
                )
                const row = href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-surface2 transition-colors">
                    {inner}
                  </a>
                ) : (
                  <span className="flex items-center gap-2.5 px-3 py-2 text-sm text-text3">
                    {inner}
                  </span>
                )
                return (
                  <TabPreviewTooltip key={key} tab={tab} favicon={favicon} row={row} />
                )
              })}
            </div>
          ))}
          </div>
        </div>
        )
      })}
    </div>
    </TooltipProvider>
  )
}
