'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { trackEvent } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface SetPasswordFormProps {
  hasPassword: boolean
}

export function SetPasswordForm({ hasPassword }: SetPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    trackEvent('set_password_completed')
    setPassword('')
    toast.success(hasPassword ? 'Password updated' : 'Password set — you can now sign in with email + password too')
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5 flex-1">
        <Label htmlFor="new-password" className="text-sm font-medium">
          {hasPassword ? 'Change password' : 'Set a password'}
        </Label>
        <PasswordInput
          id="new-password"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button type="submit" size="sm" className="h-10" disabled={loading || !password} loading={loading}>
        Save
      </Button>
    </form>
  )
}
