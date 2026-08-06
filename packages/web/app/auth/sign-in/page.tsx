'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import Image from 'next/image'

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'
  const fromExtension = searchParams.get('redirect') === 'extension'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const supabase = createClient()

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push(fromExtension ? '/dashboard' : redirectTo)
    router.refresh()
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    })
  }

  async function handleMagicLink() {
    if (!email) {
      setError('Enter your email address first.')
      return
    }
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setMagicLinkSent(true)
    }
    setLoading(false)
  }

  if (magicLinkSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a magic link to <strong>{email}</strong>. Click the link
              to sign in.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="ghost" onClick={() => setMagicLinkSent(false)}>
              Use a different email
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left — auth form, conversion moment */}
      <div className="flex flex-col p-6 sm:p-11 bg-background">
        <Link href="/" className="flex items-center gap-2 mb-auto">
          <Image src="/logo.png" alt="TabMerger" width={26} height={26} className="rounded-md" />
          <span className="font-semibold tracking-tight">TabMerger</span>
        </Link>

        <div className="w-full max-w-[380px] mx-auto py-10">
          <h1 className="text-[30px] font-semibold tracking-tight mb-2">Welcome back</h1>
          <p className="text-[14.5px] text-text2 mb-7">
            {fromExtension
              ? 'Sign in to sync your tabs across devices via the extension.'
              : 'Sign in to sync your groups across devices.'}
          </p>

          <form onSubmit={handleEmailPassword} className="flex flex-col gap-4">
            <Button
              variant="outline"
              className="w-full h-11 rounded-lg"
              onClick={handleGoogle}
              disabled={loading}
              type="button"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text3">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11 rounded-md"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11 rounded-md"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full h-[46px] rounded-lg shadow-[0_10px_26px_-12px_rgba(0,180,204,0.9)]" disabled={loading}>
              {loading ? 'Signing in...' : 'Continue'}
            </Button>
            <Button
              variant="outline"
              className="w-full h-9 text-xs rounded-md"
              onClick={handleMagicLink}
              disabled={loading}
              type="button"
            >
              Send magic link
            </Button>
          </form>

          <p className="text-[13.5px] text-text2 mt-5">
            No account?{' '}
            <Link href="/auth/sign-up" className="text-primary font-medium hover:underline">
              Sign up free
            </Link>
          </p>
        </div>

        <div className="text-xs text-text3">
          Protected by industry-standard encryption.{' '}
          <Link href="/privacy" className="text-primary hover:underline">Privacy</Link>
        </div>
      </div>

      {/* Right — brand panel, hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-center gap-7 p-11 bg-surface2 border-l border-border">
        <div className="max-w-[420px]">
          <h2 className="text-[22px] font-semibold tracking-tight leading-tight mb-2.5">
            1,308 tabs — one tidy panel.
          </h2>
          <p className="text-[14.5px] text-text2 leading-relaxed">
            Signing in turns on cloud sync, sessions and shared links.
          </p>
        </div>
      </div>
    </div>
  )
}
