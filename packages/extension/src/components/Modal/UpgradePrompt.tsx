import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface UpgradePromptModalProps {
  reason?: string;
  onClose: () => void;
}

const REASON_MESSAGES: Record<string, { title: string; description: string }> = {
  maxGroups: {
    title: 'Group Limit Reached',
    description:
      'You have reached the free plan limit of 5 groups. Upgrade to Pro for unlimited groups.'
  },
  maxTabs: {
    title: 'Tab Limit Reached',
    description:
      'You have reached the free plan limit of 50 tabs. Upgrade to Pro for unlimited tabs.'
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
  const { title, description } =
    REASON_MESSAGES[reason ?? ''] ?? {
      title: 'Upgrade TabMerger',
      description: 'Unlock unlimited groups, cloud sync, and AI features with TabMerger Pro.'
    };

  const handleUpgrade = () => {
    chrome.tabs.create({
      url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
      active: true
    });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-2">
        <div className="rounded-md border border-border p-3 space-y-1 text-xs">
          <div className="font-semibold">Free</div>
          <ul className="text-muted-foreground space-y-0.5 ml-2">
            <li>5 groups, 50 tabs</li>
            <li>Local storage only</li>
          </ul>
          <div className="font-semibold mt-2">Pro — $3.99/mo</div>
          <ul className="text-muted-foreground space-y-0.5 ml-2">
            <li>Unlimited groups & tabs</li>
            <li>Cloud sync</li>
            <li>Session save & restore</li>
          </ul>
          <div className="font-semibold mt-2">Pro AI — $7.99/mo</div>
          <ul className="text-muted-foreground space-y-0.5 ml-2">
            <li>Everything in Pro</li>
            <li>AI auto-grouping</li>
            <li>AI group naming</li>
            <li>Tab AI summaries</li>
          </ul>
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Maybe later
        </Button>
        <Button onClick={handleUpgrade}>Upgrade now</Button>
      </DialogFooter>
    </>
  );
}
