import { useEffect, useState } from 'react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import {
  setupEncryption,
  unlockEncryption,
  getEncryptionKeyState,
  ENCRYPTION_ALREADY_SET_UP_MESSAGE,
  type EncryptionKeyState
} from '@/lib/encryptionKey';
import { toast } from '@/lib/toast';

type Mode = 'checking' | 'setup' | 'unlock' | 'unavailable';

// First-time setup is offered ONLY when the server answered that the account has no key. A check
// that failed (offline, 401, 5xx) shows a retry instead: setting up over an existing key would
// leave everything already encrypted unreadable.
const MODE_BY_KEY_STATE: Record<EncryptionKeyState, Mode> = { present: 'unlock', absent: 'setup', unknown: 'unavailable' };

interface EncryptionSetupModalProps {
  onClose: () => void;
}

/**
 * Handles both encryption states in one modal, triggered from useSync's doSync gate:
 * - No `encryption_keys` row yet → first-time passphrase setup (mandatory, on-by-default).
 * - Row exists but the data key isn't unlocked on this profile yet (brand-new browser
 *   profile/device, or a fresh sign-in right after sign-out) → single-field unlock.
 * - The check could not be completed (offline, server error) → a retry, never the setup form.
 * Once unlocked, the data key persists in `chrome.storage.local` forever (see
 * encryptionKey.ts) — this modal should not reappear again barring explicit sign-out.
 * Closing without completing just re-prompts on the next sync attempt rather than
 * falling back to plaintext.
 */
export function EncryptionSetupModal({ onClose }: EncryptionSetupModalProps) {
  const [mode, setMode] = useState<Mode>('checking');
  const [attempt, setAttempt] = useState(0);
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEncryptionKeyState().then((state) => {
      if (!cancelled) setMode(MODE_BY_KEY_STATE[state]);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retryCheck = () => {
    setMode('checking');
    setAttempt((n) => n + 1);
  };

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
      const message = e instanceof Error ? e.message : 'Failed to set up encryption';
      // Another device finished setup first (the server refuses a second key): ask for that passphrase.
      if (message === ENCRYPTION_ALREADY_SET_UP_MESSAGE) {
        setMode('unlock');
        setPass1('');
        setPass2('');
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  // No confirm field here: the passphrase is checked against the account's existing key, so a
  // typo is reported as "Wrong passphrase" and nothing is stored.
  const handleUnlock = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await unlockEncryption(pass1);
      if (result === 'unlocked') {
        toast.success('Encryption unlocked');
        onClose();
      } else if (result === 'wrong-passphrase') {
        setError('Wrong passphrase');
      } else if (result === 'unavailable') {
        // The key could not be read (offline, server error): that says nothing about the passphrase.
        setMode('unavailable');
      } else {
        // The account has no key any more (reset from another device): first-time setup again.
        setMode('setup');
        setPass1('');
        setPass2('');
        setError('Encryption was reset for this account. Choose a new passphrase.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'checking') return null;

  if (mode === 'unavailable') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Can&apos;t check encryption right now</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            TabMerger couldn&apos;t reach the server to check this account&apos;s encryption, so sync is
            paused. Your groups are still saved on this device. Check your connection and try again.
          </p>
          <Button size="sm" className="text-xs w-full" onClick={retryCheck}>
            Try again
          </Button>
        </div>
      </>
    );
  }

  if (mode === 'unlock') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Unlock encryption</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleUnlock();
          }}
        >
          <p className="text-xs text-muted-foreground">
            Enter your encryption passphrase to unlock synced data on this device. This is a
            one-time step per device — you won&apos;t be asked again unless you sign out. There
            is no way to recover your data if you forget it — it never leaves your device and
            TabMerger cannot reset it for you.
          </p>
          <PasswordInput
            placeholder="Passphrase"
            aria-label="Encryption passphrase"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            className="h-8 text-xs rounded-none"
            visible={visible}
            onVisibleChange={setVisible}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="text-xs w-full" disabled={busy || !pass1} loading={busy}>
            Unlock
          </Button>
        </form>
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
