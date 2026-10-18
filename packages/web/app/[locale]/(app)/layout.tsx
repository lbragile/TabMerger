import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AccountAvatar, ACCOUNT_AVATAR_BUTTON_CLASS } from '@/components/layout/AccountAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LayoutDashboard, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { SyncIndicator } from '@/components/dashboard/SyncIndicator'
import { EncryptionKeyProvider } from '@/lib/encryption/context'
import { hasCloudSync } from '@/lib/cloudSync'
import { NOINDEX } from '@/lib/seo'

// Signed-in pages: robots.txt keeps crawlers out and signed-out visitors are redirected, so this
// only matters if a crawler ever reaches one anyway.
export const metadata: Metadata = { robots: NOINDEX }

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in')
  }

  const initials = user.email?.slice(0, 2).toUpperCase() ?? '??'

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const syncEnabled = hasCloudSync(subscription)
  const t = await getTranslations('nav')

  return (
    <EncryptionKeyProvider>
    <div className="flex min-h-screen flex-col">
      {/* On phones the row must fit ~340px: the wordmark and the nav labels hide below `sm`
          (the icons stay, named by aria-label), and the sync pill hides itself. Without
          this the header was 442px wide on a 390px screen and pushed the account menu off it. */}
      <header className="sticky top-0 z-50 flex h-16 w-full items-center border-b border-border bg-background">
        <div className="container flex items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <Link href="/" className="flex shrink-0 items-center space-x-2" aria-label={t('home')}>
              <Image src="/logo.png" alt="" width={24} height={24} className="rounded-md" />
              <span className="hidden font-bold sm:inline">TabMerger</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard" className="gap-2" aria-label={t('dashboard')}>
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('dashboard')}</span>
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/account" className="gap-2" aria-label={t('account')}>
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('account')}</span>
                </Link>
              </Button>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
          {syncEnabled && <SyncIndicator userId={user.id} />}
          {/* Icon only on phones, where the row has ~340px. */}
          <LanguageSwitcher codeClassName="hidden sm:inline" />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={ACCOUNT_AVATAR_BUTTON_CLASS}
              >
                <AccountAvatar initials={initials} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="flex flex-col space-y-1 p-2">
                <p className="text-sm font-medium leading-none">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard">{t('dashboard')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/account">{t('accountSettings')}</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <form action="/api/auth/sign-out" method="POST">
                  <button type="submit" className="w-full text-left cursor-pointer">
                    {t('signOut')}
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="flex-1 container px-4 sm:px-8 lg:px-10 py-8">{children}</main>
    </div>
    </EncryptionKeyProvider>
  )
}
