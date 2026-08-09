'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEncryptionKey } from '@/lib/encryption/context'

/**
 * Inline "unlock" card shown wherever a page needs the E2E encryption data key but it
 * hasn't been unlocked yet this session. The passphrase never leaves the browser —
 * `unlock()` only round-trips the already-wrapped key from `encryption_keys`.
 */
export function PassphrasePrompt({ label = 'Enter your encryption passphrase to view this content.' }: { label?: string }) {
  const { unlock } = useEncryptionKey()
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
      <p className="text-sm text-muted-foreground max-w-sm">{label}</p>
      <div className="flex items-center gap-2 w-full max-w-xs">
        <Input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          aria-label="Encryption passphrase"
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={busy || !passphrase}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">Incorrect passphrase.</p>}
    </form>
  )
}
