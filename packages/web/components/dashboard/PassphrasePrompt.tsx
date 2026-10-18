'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { useEncryptionKey } from '@/lib/encryption/context'

/**
 * Inline "unlock" card shown wherever a page needs the E2E encryption data key but it
 * hasn't been unlocked yet this session. The passphrase never leaves the browser —
 * `unlock()` only round-trips the already-wrapped key from `encryption_keys`.
 */
export function PassphrasePrompt({ label }: { label?: string }) {
  const { unlock } = useEncryptionKey()
  const t = useTranslations('dashboard.passphrase')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(false)
    const ok = await unlock(passphrase)
    setBusy(false)
    if (!ok) {
      setError(true)
      return
    }
    setPassphrase('')
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-dashed p-6 flex flex-col items-center gap-3 text-center">
      <Lock className="w-5 h-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground max-w-sm">{label ?? t('defaultLabel')}</p>
      <div className="flex items-center gap-2 w-full max-w-xs">
        <PasswordInput
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('inputLabel')}
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={busy || !passphrase} loading={busy}>
          {t('unlock')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{t('incorrect')}</p>}
    </form>
  )
}
