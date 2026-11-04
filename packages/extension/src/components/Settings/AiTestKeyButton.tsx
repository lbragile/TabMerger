import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiProvider } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';

/**
 * A well-formed dummy key per provider: passes the key format check (`AI_API_KEY_PATTERNS`) but is
 * no real key. Built at run time so no secret scanner reads the source as a key, and shorter than
 * the scanners' real-key patterns either way.
 */
export const DEV_TEST_KEYS: Record<AiProvider, string> = {
  anthropic: `sk-ant-mock-${'0'.repeat(24)}`,
  openai: `sk-proj-mock-${'0'.repeat(24)}`,
  google: `AIzaMock${'0'.repeat(31)}`
};

interface AiTestKeyButtonProps {
  provider: AiProvider;
  disabled?: boolean;
  /** Saves the key through the normal save path (format check, server verify, storage). */
  onUse: (key: string) => void;
}

/**
 * Settings → AI, development builds only (callers render it behind `import.meta.env.DEV`, so
 * production bundles drop it): saves the picked provider's dummy key. Only the web dev server with
 * `AI_MOCK=true` accepts it (its verify route checks the format without calling the provider);
 * anywhere else verify rejects it and the usual key error shows.
 */
export function AiTestKeyButton({ provider, disabled, onUse }: AiTestKeyButtonProps) {
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 text-xs"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => onUse(DEV_TEST_KEYS[provider])}
        data-testid="ai-byok-test-key"
      >
        {t('settings.ai.key.testKey')}
      </Button>
      <p id={hintId} className="min-w-0 text-xs text-muted-foreground">
        {t('settings.ai.key.testKeyHint')}
      </p>
    </div>
  );
}
