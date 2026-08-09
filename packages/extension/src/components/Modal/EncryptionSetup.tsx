import { useState } from 'react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setupEncryption } from '@/lib/encryptionKey';
import { toast } from 'sonner';

interface EncryptionSetupModalProps {
  onClose: () => void;
}

/**
 * One-time, mandatory passphrase setup shown the first time a signed-in Pro user's data
 * would otherwise sync without an `encryption_keys` row yet (encryption is on-by-default,
 * no opt-out). Sync stays blocked/queued (see useSync) until this completes. Closing without
 * setting up just re-prompts on the next sync attempt rather than falling back to plaintext.
 */
export function EncryptionSetupModal({ onClose }: EncryptionSetupModalProps) {
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSetup = async () => {
    setError('');
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
        <Input
          type="password"
          placeholder="New passphrase"
          value={pass1}
          onChange={(e) => setPass1(e.target.value)}
          className="h-8 text-xs rounded-none"
        />
        <Input
          type="password"
          placeholder="Confirm passphrase"
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
          className="h-8 text-xs rounded-none"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          size="sm"
          className="text-xs w-full"
          disabled={busy || !pass1 || !pass2}
          onClick={() => void handleSetup()}
        >
          Set up encryption
        </Button>
      </div>
    </>
  );
}
