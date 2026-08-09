import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LayoutDashboard, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { SyncIndicator } from '@/components/dashboard/SyncIndicator'
import { EncryptionKeyProvider } from '@/lib/encryption/context'

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

  return (
    <EncryptionKeyProvider>
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 flex h-16 w-full items-center border-b border-border bg-background">
        <div className="container flex items-center justify-between px-6 sm:px-8 lg:px-10">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center space-x-2">
              <Image src="/logo.png" alt="TabMerger" width={24} height={24} className="rounded-md" />
              <span className="font-bold">TabMerger</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard" className="gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/account" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Account
                </Link>
              </Button>
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
          <SyncIndicator userId={user.id} />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-8 w-8 rounded-full"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs font-medium bg-primary/20 text-primary">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="flex flex-col space-y-1 p-2">
                <p className="text-sm font-medium leading-none">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard">Dashboard</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/account">Account settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <form action="/api/auth/sign-out" method="POST">
                  <button type="submit" className="w-full text-left cursor-pointer">
                    Sign out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="flex-1 container px-6 sm:px-8 lg:px-10 py-8">{children}</main>
    </div>
    </EncryptionKeyProvider>
  )
}
