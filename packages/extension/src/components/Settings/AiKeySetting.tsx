import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_LABELS, byokKeyProvider, type AiProvider } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useAuth } from '@/hooks/useAuth';
import { aiPost } from '@/hooks/useAI';
import type { SavedByokKeyInfo } from '@/hooks/useByokKey';
import { AiRequestError } from '@/lib/aiErrors';
import { clearByokKey, normalizeByokKey, saveByokKey } from '@/lib/byokKey';
import { toast } from '@/lib/toast';
import { AiProviderLinks } from './AiProviderLinks';
import { AiSavedKey } from './AiSavedKey';
import { AiTestKeyButton } from './AiTestKeyButton';

/** How each provider's keys start: formats, not text to translate. */
const KEY_PLACEHOLDERS: Record<AiProvider, string> = {
  anthropic: 'sk-ant-…',
  openai: 'sk-proj-…',
  google: 'AIza…'
};

interface AiKeySettingProps {
  /** The provider picked in Settings: the key entered must be one of its keys. */
  provider: AiProvider;
  /** The saved key, masked, from `useByokKey`; null when none is saved. */
  saved: SavedByokKeyInfo | null;
  /** Re-reads the saved key after a save or removal. */
  refresh: () => Promise<unknown>;
  /** A key was saved; its provider decides which models the picker offers. */
  onSaved?: (provider: AiProvider) => void;
  /** The saved key was removed; `provider` stays picked so a new key can be pasted. */
  onRemoved?: (provider: AiProvider) => Promise<void> | void;
  /** Leaves a switch to another provider: back to the saved key's provider. */
  onCancelSwitch?: () => void;
}

/**
 * Settings → AI, own-key (BYOK) plans, once a provider is picked: that provider's API key, kept on
 * this device (lib/byokKey.ts). A key of another provider is refused here, before any request.
 * Save checks the key with the server first (`/api/ai/byok/verify`, a free call) and stores it
 * only when the provider accepts it; once saved only its masked form is shown. While another
 * provider than the saved key's is picked, the saved key stays in use until a new one is saved.
 */
export function AiKeySetting({ provider, saved, refresh, onSaved, onRemoved, onCancelSwitch }: AiKeySettingProps) {
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const userId = user?.id;
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [focusAfter, setFocusAfter] = useState<'input' | 'replace' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const errorId = useId();
  const noteId = useId();
  const switchId = useId();
  const label = AI_PROVIDER_LABELS[provider];
  const switching = !!saved && saved.provider !== provider;
  const showInput = !saved || replacing || switching;

  // The button that had focus disappears with the view it belonged to: move focus to its
  // successor once that is rendered (the saved key's query can settle a render after the click)
  useEffect(() => {
    if (!focusAfter) return;
    const target = focusAfter === 'input' ? inputRef.current : replaceRef.current;
    if (!target) return;
    target.focus();
    setFocusAfter(null);
  }, [focusAfter, showInput]);

  const handleSave = async (raw: string = value) => {
    setError(null);
    const key = normalizeByokKey(raw);
    const detected = byokKeyProvider(key);
    if (detected && detected !== provider) {
      setError(t('settings.ai.key.wrongProvider', { detected: AI_PROVIDER_LABELS[detected], provider: label }));
      return;
    }
    if (!detected) {
      setError(t('settings.ai.key.invalidFormat', { provider: label }));
      return;
    }
    if (!userId || !session?.access_token) {
      setError(t('errors.notAuthenticated'));
      return;
    }
    setChecking(true);
    try {
      const result = await aiPost<{ ok?: unknown; provider?: unknown }>('/api/ai/byok/verify', {}, session.access_token, { byokKey: key });
      // The server reads the provider from the key the same way; anything else is not a pass
      if (result?.ok !== true || (result.provider !== undefined && result.provider !== provider)) {
        throw new AiRequestError(null, 200, t('settings.ai.key.verifyFailed'));
      }
      await saveByokKey(userId, key);
      setValue('');
      setReplacing(false);
      await refresh();
      onSaved?.(provider);
      toast.success(t('settings.ai.key.saved'));
    } catch (e) {
      // A coded server error has a translated message; anything else (offline, 5xx) is generic
      setError(e instanceof AiRequestError && e.code ? e.message : t('settings.ai.key.verifyFailed'));
    } finally {
      setChecking(false);
    }
  };

  const handleRemove = async () => {
    await clearByokKey();
    await onRemoved?.(provider);
    setReplacing(false);
    await refresh();
    setFocusAfter('input');
    toast.success(t('settings.ai.key.removed'));
  };

  const handleCancel = () => {
    setValue('');
    setError(null);
    if (switching) {
      onCancelSwitch?.();
      return;
    }
    setReplacing(false);
    setFocusAfter('replace');
  };

  const describedBy = [error && errorId, switching && switchId, noteId].filter(Boolean).join(' ');

  return (
    <div className="space-y-2 min-w-0" data-testid="ai-byok-key-setting">
      <Label htmlFor={showInput ? inputId : undefined} className="text-sm">
        {t('settings.ai.key.label', { provider: label })}
      </Label>
      {switching && (
        <p id={switchId} className="text-xs" data-testid="ai-byok-switch-note">
          {t('settings.ai.key.switching', { saved: AI_PROVIDER_LABELS[saved.provider], provider: label })}
        </p>
      )}
      {showInput ? (
        <form
          className="flex items-start gap-2 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <div className="min-w-0 flex-1">
            <PasswordInput
              ref={inputRef}
              id={inputId}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder={KEY_PLACEHOLDERS[provider]}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="h-8 text-xs"
              data-testid="ai-byok-key-input"
            />
          </div>
          <Button type="submit" size="sm" className="h-8 shrink-0 text-xs" disabled={checking || !value.trim()}>
            {checking ? t('settings.ai.key.checking') : t('settings.ai.key.save')}
          </Button>
          {(replacing || switching) && (
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={handleCancel} data-testid="ai-byok-cancel">
              {t('common.cancel')}
            </Button>
          )}
        </form>
      ) : (
        <AiSavedKey ref={replaceRef} saved={saved} onReplace={() => setReplacing(true)} onRemove={() => void handleRemove()} />
      )}
      {/* Dev builds only (dropped from production bundles): a dummy key for the AI_MOCK web server */}
      {import.meta.env.DEV && showInput && (
        <AiTestKeyButton
          provider={provider}
          disabled={checking}
          onUse={(key) => {
            setValue(key);
            void handleSave(key);
          }}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive" data-testid="ai-byok-key-error">
          {error}
        </p>
      )}
      <p id={noteId} className="text-xs text-muted-foreground">
        {t('settings.ai.key.note')}
      </p>
      <AiProviderLinks provider={provider} />
    </div>
  );
}
