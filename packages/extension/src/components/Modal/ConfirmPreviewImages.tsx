import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmPreviewImagesModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/**
 * Confirms opting in to "Show page images in previews" before the setting is turned on.
 * The setting sends the hovered tab's URL to TabMerger's preview service — this is the
 * one place in the extension that transmits a URL off-device outside of encrypted cloud
 * sync, so turning it on must be an explicit, informed choice rather than a bare toggle.
 */
export function ConfirmPreviewImagesModal({ data, onClose }: ConfirmPreviewImagesModalProps) {
  const webAppUrl = import.meta.env.VITE_WEB_APP_URL as string | undefined;
  const privacyUrl = `${webAppUrl ?? ''}/privacy#page-previews`;

  const handleConfirm = () => {
    (data.onConfirm as () => void)?.();
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Turn on page images?</DialogTitle>
        <DialogDescription>
          When you hover a tab, its web address will be sent to TabMerger&apos;s preview
          service to fetch an image of the page. This isn&apos;t linked to your account,
          logged, or stored.{' '}
          <a
            href={privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
            onClick={(e) => {
              e.preventDefault();
              chrome.tabs.create({ url: privacyUrl, active: true });
            }}
          >
            Read the privacy policy
          </a>
          .
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleConfirm}>
          Turn on
        </Button>
      </DialogFooter>
    </>
  );
}
