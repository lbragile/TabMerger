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
    <main className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">Shared Groups</h1>
      <ShareBundleContent bundle={bundle} />
    </main>
  )
}
