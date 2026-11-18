import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RANDOM_SESSION_COLOR, SessionColorPicker } from './SessionColorPicker';

interface SaveSessionModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/**
 * The Save session dialog: name (required), description and an optional colour ("Random" by
 * default). `data.onSave(name, description, color)` gets `color` undefined for Random: the caller
 * picks one that differs from the last session's.
 */
export function SaveSessionModal({ data, onClose }: SaveSessionModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(false);
  const [color, setColor] = useState(RANDOM_SESSION_COLOR);
  const onSave = data.onSave as (name: string, description?: string, color?: string) => void | Promise<void>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    void onSave(trimmed, description.trim() || undefined, color === RANDOM_SESSION_COLOR ? undefined : color);
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

      <SessionColorPicker value={color} onChange={setColor} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('modals.saveSession.cancel')}
        </Button>
        <Button type="submit">{t('modals.saveSession.save')}</Button>
      </DialogFooter>
    </form>
  );
}
