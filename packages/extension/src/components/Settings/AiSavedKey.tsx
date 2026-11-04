import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_LABELS } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import type { SavedByokKeyInfo } from '@/hooks/useByokKey';

interface AiSavedKeyProps {
  saved: SavedByokKeyInfo;
  onReplace: () => void;
  onRemove: () => void;
}

/**
 * The saved own key as Settings → AI shows it: provider and masked key (never the key), with
 * Replace and Remove. The ref is the Replace button, so focus can return to it after a Cancel.
 */
export const AiSavedKey = forwardRef<HTMLButtonElement, AiSavedKeyProps>(function AiSavedKey({ saved, onReplace, onRemove }, replaceRef) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="min-w-0 truncate text-xs">
        <span className="me-1">{AI_PROVIDER_LABELS[saved.provider]}</span>
        <code data-testid="ai-byok-key-masked" dir="ltr">
          {saved.masked}
        </code>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button ref={replaceRef} variant="outline" size="sm" className="h-7 text-xs" onClick={onReplace}>
          {t('settings.ai.key.replace')}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={onRemove}>
          {t('settings.ai.key.remove')}
        </Button>
      </div>
    </div>
  );
});
