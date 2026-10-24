import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from '@tabmerger/shared';

interface AiProviderPickerProps {
  /** The picked provider; null until one is picked (no key saved, nothing picked yet). */
  value: AiProvider | null;
  onChange: (provider: AiProvider) => void;
}

/**
 * Settings → AI, own-key plans: which company's API key the user brings (Anthropic, OpenAI or
 * Google). Picked first: the key field, setup links and model picker only show once a provider is
 * picked. Native radio inputs, so Tab enters the group and arrow keys move the choice. The ref is
 * the fieldset, so a caller can move focus back to the checked option.
 */
export const AiProviderPicker = forwardRef<HTMLFieldSetElement, AiProviderPickerProps>(function AiProviderPicker({ value, onChange }, ref) {
  const { t } = useTranslation();
  const name = useId();
  const descriptionId = useId();
  return (
    <fieldset ref={ref} className="min-w-0 space-y-2" aria-describedby={descriptionId} data-testid="ai-provider-picker">
      <legend className="text-sm font-medium">{t('settings.ai.provider.label')}</legend>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {t('settings.ai.provider.description')}
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        {AI_PROVIDERS.map((provider) => (
          <label
            key={provider}
            className="flex min-w-0 cursor-pointer items-center gap-2 border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            data-testid={`ai-provider-${provider}`}
          >
            <input
              type="radio"
              name={name}
              value={provider}
              checked={value === provider}
              onChange={() => onChange(provider)}
              className="shrink-0 accent-primary"
            />
            <span className="truncate">{AI_PROVIDER_LABELS[provider]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
});
