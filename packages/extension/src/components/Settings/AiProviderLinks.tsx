import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_KEY_LINKS, AI_PROVIDER_LABELS, type AiProvider } from '@tabmerger/shared';
import { openInNewTab } from '@/lib/websiteLink';

/** An external page, opened in a new tab (the popup can't follow a plain link). */
function ExternalLink({ url, children, testId }: { url: string; children: ReactNode; testId: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => openInNewTab(e, url)} data-testid={testId}>
      {children}
    </a>
  );
}

/**
 * Setup links for one own-key provider ({@link AI_PROVIDER_KEY_LINKS}): how to create a key, and
 * the provider's API keys page, where the key's spending limit is set too.
 */
export function AiProviderLinks({ provider }: { provider: AiProvider }) {
  const { t } = useTranslation();
  const links = AI_PROVIDER_KEY_LINKS[provider];
  return (
    <p className="text-xs text-muted-foreground" data-testid="ai-provider-links">
      {t('settings.ai.key.getKey')}{' '}
      <ExternalLink url={links.guide} testId="ai-provider-guide-link">
        {t('settings.ai.key.guideLink')}
      </ExternalLink>
      {' · '}
      <ExternalLink url={links.keys} testId="ai-provider-keys-link">
        {t('settings.ai.key.keysLink', { provider: AI_PROVIDER_LABELS[provider] })}
      </ExternalLink>
    </p>
  );
}
