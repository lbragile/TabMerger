import { createClient } from '@/lib/supabase/server'
import { ShareBundleContent } from '@/components/ShareBundleContent'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('shared_bundles')
    .select('slug, user_id, groups_snapshot, created_at, expires_at')
    .eq('slug', slug)
    .single()

  const bundle = data
    ? {
        slug: data.slug,
        expiresAt: data.expires_at ?? null,
        groups: data.groups_snapshot ?? [],
      }
    : null

  return (
    <main className="max-w-3xl mx-auto px-4 py-14">
      <div className="mb-8">
        <span className="inline-flex items-center h-6 px-2.5 rounded-md bg-surface2 border border-border text-[11.5px] text-text2 mb-3.5">
          Shared collection · read-only
        </span>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight mb-2">Shared Groups</h1>
        {bundle?.expiresAt && (
          <p className="text-[13px] text-text2">Link expires {new Date(bundle.expiresAt).toLocaleDateString()}</p>
        )}
      </div>
      <ShareBundleContent bundle={bundle} />
      <div className="mt-8 rounded-2xl border border-dashed border-border2 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
        <div className="flex-1">
          <p className="font-semibold text-[14.5px] mb-0.5">Open all your tabs at once</p>
          <p className="text-[13px] text-text2">Install TabMerger and this collection becomes a group you can restore in a click.</p>
        </div>
        <a
          href="https://chrome.google.com/webstore"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[13.5px] font-medium shadow-[0_10px_26px_-10px_rgba(0,180,204,0.9)] hover:bg-primary/90 hover:shadow-[0_14px_30px_-10px_rgba(0,180,204,1)] transition-all inline-flex items-center justify-center"
        >
          Install free
        </a>
      </div>
    </main>
  )
}
