import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAnthropicApiKey, maskApiKey } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useAuth } from '@/hooks/useAuth';
import { aiPost } from '@/hooks/useAI';
import { AiRequestError } from '@/lib/aiErrors';
import { clearByokKey, getByokKey, normalizeByokKey, saveByokKey } from '@/lib/byokKey';
import { toast } from '@/lib/toast';

/** Where an Anthropic account creates API keys and sets its spending limit. */
export const ANTHROPIC_CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

/** The start of every Anthropic key: a format, not text to translate. */
const KEY_PLACEHOLDER = 'sk-ant-…';

/** Query key of the saved key's masked form (the raw key never enters the query cache). */
const maskedKeyQueryKey = (userId: string | undefined) => ['aiByokKeyMasked', userId] as const;

/**
 * Settings → AI, own-key (BYOK) plans only: the Anthropic API key kept on this device
 * (lib/byokKey.ts). Save checks the key with the server first (`/api/ai/byok/verify`, a free
 * call) and stores it only when Anthropic accepts it; once saved only its masked form is shown.
 */
export function AiKeySetting() {
  const { t } = useTranslation();
  const { user, session } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { data: masked } = useQuery({
    queryKey: maskedKeyQueryKey(userId),
    queryFn: async () => {
      const key = await getByokKey(userId);
      return key ? maskApiKey(key) : null;
    },
    enabled: !!userId
  });
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const noteId = useId();

  const refresh = () => queryClient.invalidateQueries({ queryKey: maskedKeyQueryKey(userId) });

  const handleSave = async () => {
    setError(null);
    const key = normalizeByokKey(value);
    if (!isAnthropicApiKey(key)) {
      setError(t('settings.ai.key.invalidFormat'));
      return;
    }
    if (!userId || !session?.access_token) {
      setError(t('errors.notAuthenticated'));
      return;
    }
    setChecking(true);
    try {
      const result = await aiPost<{ ok?: unknown }>('/api/ai/byok/verify', {}, session.access_token, { byokKey: key });
      if (result?.ok !== true) throw new AiRequestError(null, 200, t('settings.ai.key.verifyFailed'));
      await saveByokKey(userId, key);
      setValue('');
      setReplacing(false);
      await refresh();
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

  const showInput = !masked || replacing;

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
              aria-invalid={error ? true : undefined}
              aria-describedby={`${error ? `${errorId} ` : ''}${noteId}`}
              className="h-8 text-xs rounded-none"
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
          <code className="min-w-0 truncate text-xs" data-testid="ai-byok-key-masked" dir="ltr">
            {masked}
          </code>
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
        <a
          href={ANTHROPIC_CONSOLE_KEYS_URL}
          className="underline"
          onClick={(e) => {
            e.preventDefault();
            chrome.tabs.create({ url: ANTHROPIC_CONSOLE_KEYS_URL, active: true });
          }}
        >
          {t('settings.ai.key.consoleLink')}
        </a>
      </p>
    </div>
  );
}
