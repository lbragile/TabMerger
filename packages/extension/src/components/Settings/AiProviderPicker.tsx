import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from '@tabmerger/shared';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_SELECT_CONTENT_CLASS, AI_SELECT_TRIGGER_CLASS } from '@/components/Settings/settingsControls';

interface AiProviderPickerProps {
  /** The picked provider; null until one is picked (no key saved, nothing picked yet). */
  value: AiProvider | null;
  onChange: (provider: AiProvider) => void;
}

/** Radix Select shows its placeholder for an empty string; a null pick is no value. */
const NO_PROVIDER = '';

const isAiProvider = (value: string): value is AiProvider => (AI_PROVIDERS as readonly string[]).includes(value);

/**
 * Settings → AI, own-key plans: which company's API key the user brings (Anthropic, OpenAI or
 * Google), as a dropdown in a Settings row. Picked first: the key field, setup links and model
 * picker only show once a provider is picked; until then the dropdown shows "Choose a provider".
 * The trigger, the same fixed width as the model dropdown's, is named by the row's heading and
 * described by its hint. The ref is the trigger, so a caller can move focus back to it.
 */
export const AiProviderPicker = forwardRef<HTMLButtonElement, AiProviderPickerProps>(function AiProviderPicker({ value, onChange }, ref) {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex min-w-0 items-center justify-between gap-4" data-testid="ai-provider-picker">
      <div className="min-w-0 flex-1">
        <Label id={labelId} className="text-sm">
          {t('settings.ai.provider.label')}
        </Label>
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {t('settings.ai.provider.description')}
        </p>
      </div>
      <Select value={value ?? NO_PROVIDER} onValueChange={(next) => isAiProvider(next) && onChange(next)}>
        <SelectTrigger
          ref={ref}
          className={AI_SELECT_TRIGGER_CLASS}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          // The full text when a long value is cut with an ellipsis
          title={value ? AI_PROVIDER_LABELS[value] : t('settings.ai.provider.placeholder')}
          data-testid="ai-provider-select"
        >
          <SelectValue placeholder={t('settings.ai.provider.placeholder')} />
        </SelectTrigger>
        <SelectContent align="end" collisionPadding={8} className={AI_SELECT_CONTENT_CLASS}>
          {AI_PROVIDERS.map((provider) => (
            <SelectItem key={provider} value={provider} data-testid={`ai-provider-${provider}`}>
              {AI_PROVIDER_LABELS[provider]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
});
