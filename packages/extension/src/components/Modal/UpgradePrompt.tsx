import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber, type MessageKey } from '@/lib/i18n';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';
import { AI_ENABLED } from '@/lib/aiFlag';
import { FREE_TIER_LIMITS, PRICING_TIERS } from '@tabmerger/shared';

/**
 * The compact comparison's first features of each plan (the popup is 800×600), in the same order
 * as PRICING_TIERS' feature lists (a catalog test keeps the English identical to those).
 */
const PLAN_FEATURE_KEYS: Record<string, readonly MessageKey[]> = {
  free: ['upgrade.plans.free.f1', 'upgrade.plans.free.f2', 'upgrade.plans.free.f3'],
  pro: ['upgrade.plans.pro.f1', 'upgrade.plans.pro.f2', 'upgrade.plans.pro.f3'],
  pro_ai: ['upgrade.plans.pro_ai.f1', 'upgrade.plans.pro_ai.f2', 'upgrade.plans.pro_ai.f3'],
};
const PLAN_NAME_KEYS: Record<string, MessageKey> = {
  free: 'upgrade.plans.free.name',
  pro: 'upgrade.plans.pro.name',
  pro_ai: 'upgrade.plans.pro_ai.name',
};

interface UpgradePromptModalProps {
  reason?: string;
  onClose: () => void;
}

const REASON_KEYS = ['maxGroups', 'maxTabs', 'cloudSync', 'aiFeatures'] as const;
type Reason = (typeof REASON_KEYS)[number];
const isReason = (r: string | undefined): r is Reason => (REASON_KEYS as readonly string[]).includes(r ?? '');

export function UpgradePromptModal({ reason, onClose }: UpgradePromptModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const openModal = useUIStore((s) => s.openModal);

  useEffect(() => {
    trackEvent('upgrade_prompt_shown', { source: reason ?? 'upgrade_prompt' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limits = { max: reason === 'maxTabs' ? FREE_TIER_LIMITS.tabs : FREE_TIER_LIMITS.groups };
  const { title, description } = isReason(reason)
    ? { title: t(`upgrade.${reason}.title`), description: t(`upgrade.${reason}.description`, limits) }
    : { title: t('upgrade.default.title'), description: t('upgrade.default.description') };

  // AI features: coming soon — this modal is the one place the Pro AI tier row is
  // never fully hidden (per product decision), it just shows a coming-soon price
  // and a disabled CTA. Only disable the primary CTA when the prompt was shown
  // specifically because the user wanted AI features — a maxGroups/maxTabs/cloudSync
  // upgrade must still work normally.
  const proAiComingSoon = !AI_ENABLED;
  const ctaDisabled = proAiComingSoon && reason === 'aiFeatures';

  const handleUpgrade = () => {
    if (ctaDisabled) return;
    trackEvent('upgrade_clicked', { source: reason ?? 'upgrade_prompt' });
    chrome.tabs.create({
      url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
      active: true
    });
    onClose();
  };

  const handleSignIn = () => {
    onClose();
    openModal('auth');
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description}
          {!user && t('upgrade.signInHint')}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-2">
        <div className="border border-border p-3 space-y-1 text-xs">
          {PRICING_TIERS.map((plan, i) => (
            <div key={plan.id}>
              <div className={i > 0 ? 'font-semibold mt-2' : 'font-semibold'}>
                {PLAN_NAME_KEYS[plan.id] ? t(PLAN_NAME_KEYS[plan.id]) : plan.name}
                {plan.monthlyPrice > 0 && t('upgrade.planPrice', { price: formatNumber(plan.monthlyPrice, { style: 'currency', currency: 'USD' }) })}
                {plan.id === 'pro_ai' && proAiComingSoon && (
                  <span className="ml-1 text-muted-foreground font-normal">
                    {t('upgrade.comingSoonParen', { label: t('upgrade.comingSoon') })}
                  </span>
                )}
              </div>
              <ul className="text-muted-foreground space-y-0.5 ml-2">
                {(PLAN_FEATURE_KEYS[plan.id] ?? []).map((key) => (
                  <li key={key}>{t(key, FREE_TIER_LIMITS)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          {t('upgrade.maybeLater')}
        </Button>
        {!user && (
          <Button variant="outline" onClick={handleSignIn}>
            {t('upgrade.signIn')}
          </Button>
        )}
        <Button onClick={handleUpgrade} disabled={ctaDisabled} aria-disabled={ctaDisabled}>
          {ctaDisabled ? t('upgrade.comingSoon') : t('upgrade.upgradeNow')}
        </Button>
      </DialogFooter>
    </>
  );
}
