import { useEffect, useState } from 'react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { setupEncryption, unlockEncryption, hasEncryptionKey } from '@/lib/encryptionKey';
import { toast } from '@/lib/toast';

interface EncryptionSetupModalProps {
  onClose: () => void;
}

/**
 * Handles both encryption states in one modal, triggered from useSync's doSync gate:
 * - No `encryption_keys` row yet → first-time passphrase setup (mandatory, on-by-default).
 * - Row exists but the data key isn't unlocked on this profile yet (brand-new browser
 *   profile/device, or a fresh sign-in right after sign-out) → single-field unlock.
 * Once unlocked, the data key persists in `chrome.storage.local` forever (see
 * encryptionKey.ts) — this modal should not reappear again barring explicit sign-out.
 * Closing without completing just re-prompts on the next sync attempt rather than
 * falling back to plaintext.
 */
export function EncryptionSetupModal({ onClose }: EncryptionSetupModalProps) {
  const [mode, setMode] = useState<'checking' | 'setup' | 'unlock'>('checking');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void hasEncryptionKey().then((v) => setMode(v ? 'unlock' : 'setup'));
  }, []);

  const handleSetup = async () => {
    setError('');
    if (/\s/.test(pass1)) {
      setError('Passphrase cannot contain spaces');
      return;
    }
    if (pass1.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }
    if (pass1 !== pass2) {
      setError('Passphrases do not match');
      return;
    }
    setBusy(true);
    try {
      await setupEncryption(pass1);
      toast.success('Encryption set up');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set up encryption');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError('');
    if (pass1 !== pass2) {
      setError('Passphrases do not match');
      return;
    }
    setBusy(true);
    try {
      const ok = await unlockEncryption(pass1);
      if (!ok) {
        setError('Wrong passphrase');
        return;
      }
      toast.success('Encryption passphrase set');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'checking') return null;

  if (mode === 'unlock') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Unlock encryption</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter your encryption passphrase to unlock synced data on this device. This is a
            one-time step per device — you won&apos;t be asked again unless you sign out. There
            is no way to recover your data if you forget it — it never leaves your device and
            TabMerger cannot reset it for you.
          </p>
          <PasswordInput
            placeholder="Passphrase"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            className="h-8 text-xs rounded-none"
            visible={visible}
            onVisibleChange={setVisible}
          />
          <PasswordInput
            placeholder="Confirm passphrase"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            className="h-8 text-xs rounded-none"
            visible={visible}
            showToggle={false}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            size="sm"
            className="text-xs w-full"
            disabled={busy || !pass1 || !pass2}
            loading={busy}
            onClick={() => void handleUnlock()}
          >
            Save
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up encryption</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Your synced group and tab data is end-to-end encrypted with a passphrase only you
          know. Choose one now — there is no way to recover your data if you forget it, it
          never leaves your device and TabMerger cannot reset it for you.
        </p>
        <PasswordInput
          placeholder="New passphrase"
          value={pass1}
          onChange={(e) => setPass1(e.target.value)}
          className="h-8 text-xs rounded-none"
          visible={visible}
          onVisibleChange={setVisible}
        />
        <PasswordInput
          placeholder="Confirm passphrase"
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
          className="h-8 text-xs rounded-none"
          visible={visible}
          showToggle={false}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          size="sm"
          className="text-xs w-full"
          disabled={busy || !pass1 || !pass2}
          loading={busy}
          onClick={() => void handleSetup()}
        >
          Set up encryption
        </Button>
      </div>
    </>
  );
}
