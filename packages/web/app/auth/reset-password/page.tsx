'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import Image from 'next/image'

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError(t('passwordsDontMatch'))
      return
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('passwordTooShort', { min: MIN_PASSWORD_LENGTH }))
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="TabMerger" width={32} height={32} className="rounded-md" />
          </Link>
          <h1 className="text-2xl font-bold">{t('resetPassword.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('resetPassword.lead')}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('resetPassword.cardTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">{t('password')}</Label>
                <PasswordInput
                  id="password"
                  placeholder={t('newPasswordPlaceholder', { min: MIN_PASSWORD_LENGTH })}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  visible={passwordVisible}
                  onVisibleChange={setPasswordVisible}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">{t('confirmPassword')}</Label>
                <PasswordInput
                  id="confirm-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  visible={passwordVisible}
                  showToggle={false}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading} loading={loading}>
                {t('resetPassword.submit')}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <Button variant="ghost" asChild>
              <Link href="/auth/sign-in">{t('backToSignIn')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
