import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useUIStore } from '@/stores/uiStore';
import { AddGroupModal } from './AddGroup';
import { DeleteConfirmModal } from './DeleteConfirm';
import { ImportExportModal } from './ImportExport';
import { NoteModal } from './Note';
import { SettingsModal } from './Settings';
import { AuthModal } from './Auth';
import { UpgradePromptModal } from './UpgradePrompt';
import { DeduplicateConfirmModal } from './DeduplicateConfirm';
import { UrlRulesModal } from './UrlRules';
import { ReviewStaleTabsModal } from './ReviewStaleTabs';
import { SaveSessionModal } from './SaveSession';
import { ShortcutSavePickerModal } from './ShortcutSavePicker';
import { ReviewStaleGroupModal } from './ReviewStaleGroup';
import { EncryptionSetupModal } from './EncryptionSetup';

export function ModalRoot() {
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);

  if (!modal.type) return null;

  const content = () => {
    switch (modal.type) {
      case 'addGroup':
        return <AddGroupModal onClose={closeModal} data={modal.data} />;
      case 'deleteGroup':
      case 'deleteWindow':
      case 'deleteTab':
      case 'deleteSelection':
      case 'removeStaleTabs':
      case 'archiveStaleGroups':
      case 'clearAllData':
      case 'resetEncryption':
        return (
          <DeleteConfirmModal
            type={modal.type}
            data={modal.data ?? {}}
            onClose={closeModal}
          />
        );
      case 'saveSession':
        return <SaveSessionModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'note':
        return <NoteModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'importExport':
        return <ImportExportModal mode={(modal.data?.mode as string) ?? 'export'} data={modal.data ?? {}} onClose={closeModal} />;
      case 'settings':
        return <SettingsModal onClose={closeModal} />;
      case 'auth':
        return <AuthModal onClose={closeModal} />;
      case 'upgrade':
        return <UpgradePromptModal reason={modal.data?.reason as string} onClose={closeModal} />;
      case 'deduplicateGroup':
        return <DeduplicateConfirmModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'urlRules':
        return <UrlRulesModal onClose={closeModal} />;
      case 'reviewStaleTabs':
        return <ReviewStaleTabsModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'shortcutSavePicker':
        return <ShortcutSavePickerModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'reviewStaleGroup':
        return <ReviewStaleGroupModal data={modal.data ?? {}} onClose={closeModal} />;
      case 'encryptionSetup':
        return <EncryptionSetupModal onClose={closeModal} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={!!modal.type} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="max-w-md">{content()}</DialogContent>
    </Dialog>
  );
}
