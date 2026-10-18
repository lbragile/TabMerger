import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { checkForUpdate, type UpdateCheckResult } from '@/lib/extensionUpdate';

/**
 * Settings → General: "Check for updates". Asks the browser to look for a newer version now
 * (`runtime.requestUpdateCheck`) and says how it went in a toast. A found update is recorded, so
 * the popup's "Restart to update" banner appears as well.
 */
export function CheckForUpdates() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);

  const announce = (result: UpdateCheckResult) => {
    switch (result.status) {
      case 'update_available':
        if (result.version) toast.success(t('settings.updates.available', { version: result.version }));
        else toast.success(t('settings.updates.availableNoVersion'));
        return;
      case 'no_update':
        toast.success(t('settings.updates.noUpdate'));
        return;
      case 'throttled':
        toast.info(t('settings.updates.throttled'));
        return;
      case 'unsupported':
        toast.info(t('settings.updates.unsupported'));
        return;
      default:
        toast.error(t('settings.updates.error'));
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      announce(await checkForUpdate());
    } catch {
      toast.error(t('settings.updates.error'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label className="text-sm">{t('settings.updates.label')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.updates.description')}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 text-xs"
        onClick={() => void handleCheck()}
        disabled={checking}
        aria-busy={checking}
      >
        {checking ? t('settings.updates.checking') : t('settings.updates.button')}
      </Button>
    </div>
  );
}
