import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDERS, AI_PROVIDER_KEY_URLS, AI_PROVIDER_LABELS, byokKeyProvider, type AiProvider } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useAuth } from '@/hooks/useAuth';
import { aiPost } from '@/hooks/useAI';
import type { SavedByokKeyInfo } from '@/hooks/useByokKey';
import { AiRequestError } from '@/lib/aiErrors';
import { clearByokKey, normalizeByokKey, saveByokKey } from '@/lib/byokKey';
import { toast } from '@/lib/toast';

/** How the supported keys start: formats, not text to translate. */
const KEY_PLACEHOLDER = 'sk-ant-… / sk-… / AIza…';

interface AiKeySettingProps {
  /** The saved key, masked, from `useByokKey`; null when none is saved. */
  saved: SavedByokKeyInfo | null;
  /** Re-reads the saved key after a save or removal. */
  refresh: () => Promise<unknown>;
  /** A key was saved; its provider decides which models the picker offers. */
  onSaved?: (provider: AiProvider) => void;
}

/** Opens a provider's key page in a new tab (the popup can't follow a plain link). */
function ProviderLink({ provider, children }: { provider: AiProvider; children: React.ReactNode }) {
  const url = AI_PROVIDER_KEY_URLS[provider];
  return (
    <a
      href={url}
      className="underline"
      onClick={(e) => {
        e.preventDefault();
        chrome.tabs.create({ url, active: true });
      }}
    >
      {children}
    </a>
  );
}

/**
 * Settings → AI, own-key (BYOK) plans only: the API key kept on this device (lib/byokKey.ts), from
 * Anthropic, OpenAI or Google, one at a time. The provider is read from the key's shape. Save
 * checks the key with the server first (`/api/ai/byok/verify`, a free call) and stores it only
 * when the provider accepts it; once saved only its masked form is shown.
 */
export function AiKeySetting({ saved, refresh, onSaved }: AiKeySettingProps) {
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const userId = user?.id;
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const noteId = useId();

  const handleSave = async () => {
    setError(null);
    const key = normalizeByokKey(value);
    const provider = byokKeyProvider(key);
    if (!provider) {
      setError(t('settings.ai.key.invalidFormat'));
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
    setReplacing(false);
    await refresh();
    toast.success(t('settings.ai.key.removed'));
  };

  const showInput = !saved || replacing;

  return (
    <div className="space-y-2 min-w-0">
      <Label htmlFor={showInput ? inputId : undefined} className="text-sm">
        {t('settings.ai.key.label')}
      </Label>
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
              id={inputId}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder={KEY_PLACEHOLDER}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${error ? `${errorId} ` : ''}${noteId}`}
              className="h-8 text-xs"
              data-testid="ai-byok-key-input"
            />
          </div>
          <Button type="submit" size="sm" className="h-8 shrink-0 text-xs" disabled={checking || !value.trim()}>
            {checking ? t('settings.ai.key.checking') : t('settings.ai.key.save')}
          </Button>
          {replacing && (
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => setReplacing(false)}>
              {t('common.cancel')}
            </Button>
          )}
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 truncate text-xs">
            <span className="me-1">{AI_PROVIDER_LABELS[saved.provider]}</span>
            <code data-testid="ai-byok-key-masked" dir="ltr">
              {saved.masked}
            </code>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setReplacing(true)}>
              {t('settings.ai.key.replace')}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => void handleRemove()}>
              {t('settings.ai.key.remove')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p id={noteId} className="text-xs text-muted-foreground">
        {t('settings.ai.key.note')}{' '}
        {saved && !replacing ? (
          <ProviderLink provider={saved.provider}>
            {t('settings.ai.key.manageLink', { provider: AI_PROVIDER_LABELS[saved.provider] })}
          </ProviderLink>
        ) : (
          <>
            {t('settings.ai.key.getKey')}{' '}
            {AI_PROVIDERS.map((provider, i) => (
              <Fragment key={provider}>
                {i > 0 && ' · '}
                <ProviderLink provider={provider}>{AI_PROVIDER_LABELS[provider]}</ProviderLink>
              </Fragment>
            ))}
          </>
        )}
      </p>
    </div>
  );
}
