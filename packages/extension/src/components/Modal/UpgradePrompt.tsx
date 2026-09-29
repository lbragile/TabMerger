import { useEffect } from 'react';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';
import { AI_ENABLED } from '@/lib/aiFlag';
import { AI_COMING_SOON_LABEL, FREE_TIER_LIMITS, PRICING_TIERS } from '@tabmerger/shared';

/** How many of each plan's features the compact comparison shows (the popup is 800×600). */
const PROMPT_FEATURE_COUNT = 3;

interface UpgradePromptModalProps {
  reason?: string;
  onClose: () => void;
}

const REASON_MESSAGES: Record<string, { title: string; description: string }> = {
  maxGroups: {
    title: 'Group Limit Reached',
    description:
      `You have reached the free plan limit of ${FREE_TIER_LIMITS.groups} groups. Upgrade to Pro for unlimited groups.`
  },
  maxTabs: {
    title: 'Tab Limit Reached',
    description:
      `You have reached the free plan limit of ${FREE_TIER_LIMITS.tabs} tabs. Upgrade to Pro for unlimited tabs.`
  },
  cloudSync: {
    title: 'Cloud Sync is Pro',
    description:
      'Sync your groups across all your devices with TabMerger Pro. Upgrade to enable cloud sync.'
  },
  aiFeatures: {
    title: 'AI Features are Pro AI',
    description:
      'AI auto-grouping, smart naming, and tab summaries are available in the Pro AI plan.'
  }
};

export function UpgradePromptModal({ reason, onClose }: UpgradePromptModalProps) {
  const { user } = useAuth();
  const openModal = useUIStore((s) => s.openModal);

  useEffect(() => {
    trackEvent('upgrade_prompt_shown', { source: reason ?? 'upgrade_prompt' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { title, description } =
    REASON_MESSAGES[reason ?? ''] ?? {
      title: 'Upgrade TabMerger',
      description: 'Unlock unlimited groups, cloud sync, and AI features with TabMerger Pro.'
    };

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
          {!user && ' Already have a Pro account? Sign in to restore it on this device.'}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-2">
        <div className="border border-border p-3 space-y-1 text-xs">
          {PRICING_TIERS.map((plan, i) => (
            <div key={plan.id}>
              <div className={i > 0 ? 'font-semibold mt-2' : 'font-semibold'}>
                {plan.name}
                {plan.monthlyPrice > 0 && ` — $${plan.monthlyPrice}/mo`}
                {plan.id === 'pro_ai' && proAiComingSoon && (
                  <span className="ml-1 text-muted-foreground font-normal">
                    ({AI_COMING_SOON_LABEL})
                  </span>
                )}
              </div>
              <ul className="text-muted-foreground space-y-0.5 ml-2">
                {plan.features.slice(0, PROMPT_FEATURE_COUNT).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Maybe later
        </Button>
        {!user && (
          <Button variant="outline" onClick={handleSignIn}>
            Sign in
          </Button>
        )}
        <Button onClick={handleUpgrade} disabled={ctaDisabled} aria-disabled={ctaDisabled}>
          {ctaDisabled ? AI_COMING_SOON_LABEL : 'Upgrade now'}
        </Button>
      </DialogFooter>
    </>
  );
}
