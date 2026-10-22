import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface SaveSessionModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** Data-tab equivalent of Header's "Save session" action — replaces window.prompt(). */
export function SaveSessionModal({ data, onClose }: SaveSessionModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(false);
  const onSave = data.onSave as (name: string, description?: string) => void | Promise<void>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    void onSave(trimmed, description.trim() || undefined);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{t('modals.saveSession.title')}</DialogTitle>
      </DialogHeader>

      <div className="space-y-1.5 py-4">
        <Label htmlFor="session-name" className="mb-1.5 block">{t('modals.saveSession.name')}</Label>
        <Input
          id="session-name"
          dir={name ? 'auto' : undefined}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(false);
          }}
          placeholder={t('modals.saveSession.namePlaceholder')}
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{t('modals.saveSession.nameRequired')}</p>}
      </div>

      <div className="space-y-1.5 pb-4">
        <Label htmlFor="session-description" className="mb-1.5 block">{t('modals.saveSession.description')}</Label>
        <Textarea
          id="session-description"
          dir={description ? 'auto' : undefined}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('modals.saveSession.descriptionPlaceholder')}
          rows={3}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('modals.saveSession.cancel')}
        </Button>
        <Button type="submit">{t('modals.saveSession.save')}</Button>
      </DialogFooter>
    </form>
  );
}
