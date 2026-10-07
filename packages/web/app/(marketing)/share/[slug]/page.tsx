import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ShareBundleContent } from '@/components/ShareBundleContent'
import { CopyShareUrl } from '@/components/CopyShareUrl'
import { getStoreLinks, storeLinkProps } from '@/lib/storeLinks'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params

  // ponytail: plain anon client (no cookies) — this lookup is public-by-design
  // (RLS: shared_bundles_select_public using(true)) and must never depend on the
  // visitor's own session. The cookie-bound server client attaches whatever stale
  // access-token cookie is present (autoRefreshToken is off — see lib/supabase/server.ts),
  // and an expired JWT gets rejected by PostgREST with a 401 instead of falling back to
  // anon — which silently turned valid share links into "not found" for anyone with a
  // stale session cookie. A bare anon-key client sends no Authorization header at all.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  const { data, error } = await supabase
    .from('shared_bundles')
    .select('slug, user_id, groups_snapshot, created_at, expires_at')
    .eq('slug', slug)
    .single()

  // PGRST116 = "no rows" for .single() — the expected/legitimate not-found case.
  // Anything else (RLS/auth/network/schema issues) is a real failure; log it so it's
  // debuggable instead of silently rendering the same generic "not found" screen.
  if (error && error.code !== 'PGRST116') {
    console.error('[share page] unexpected error fetching shared bundle', slug, error)
  }

  // A genuinely nonexistent slug must 404 rather than render the page shell with a
  // "Link not found" message at 200 — search engines/monitoring and the E2E suite both
  // depend on the real status code here. Expired links are a different case (the row
  // exists) and intentionally still render at 200 with ShareBundleContent's own
  // "Link expired" message below.
  if (!data) {
    notFound()
  }

  const bundle = {
    slug: data.slug,
    expiresAt: data.expires_at ?? null,
    // ponytail: may be a legacy plaintext Group[] (pre-encryption shares still
    // live in the DB, no backfill) or a {v:1,iv,ct} ciphertext blob — ShareBundleContent
    // tells them apart and decrypts the latter using the key from the URL fragment.
    groups: data.groups_snapshot ?? [],
  }

  // ponytail: derive origin from the incoming request instead of adding a new env var —
  // works in dev, preview, and prod without another value to keep in sync.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'tabmerger.vercel.app'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const shareUrl = `${proto}://${host}/share/${slug}`
  const storeLinks = getStoreLinks()

  return (
    <main className="max-w-3xl mx-auto px-4 py-14">
      <div className="mb-6 rounded-2xl border border-dashed border-border2 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
        <div className="flex-1">
          <p className="font-semibold text-[14.5px] mb-0.5">Open all your tabs at once</p>
          <p className="text-[13px] text-text2">Install TabMerger and this collection becomes a group you can restore in a click.</p>
        </div>
        <a
          {...storeLinkProps(storeLinks.chrome)}
          className="shrink-0 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors inline-flex items-center justify-center"
        >
          Install free
        </a>
      </div>
      <div className="mb-8">
        <span className="inline-flex items-center h-6 px-2.5 rounded-md bg-surface2 border border-border text-[11.5px] text-text2 mb-3.5">
          Shared collection · read-only
        </span>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight mb-2">Shared Groups</h1>
        {bundle && <CopyShareUrl url={shareUrl} />}
        {bundle?.expiresAt && (
          <p className="text-[13px] text-text2 mt-2">Link expires {new Date(bundle.expiresAt).toLocaleDateString()}</p>
        )}
      </div>
      <ShareBundleContent bundle={bundle} />
    </main>
  )
}
