import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, ChevronUp, ChevronDown, Link, Pencil, Plus } from 'lucide-react';
import { useGroups } from '@/hooks/useGroups';
import { useUrlRules, useSaveUrlRules } from '@/hooks/useUrlRules';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { UrlRule } from '@/lib/types';
import { toast } from 'sonner';

const FREE_RULE_LIMIT = 3;

interface UrlRulesModalProps {
  onClose: () => void;
}

function GroupDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle shrink-0"
      style={{ background: color }}
    />
  );
}

export function UrlRulesModal({ onClose }: UrlRulesModalProps) {
  const { data: groupsState } = useGroups();
  const { data: persistedRules = [] } = useUrlRules();
  const { mutate: saveRules } = useSaveUrlRules();
  const { tier } = useEntitlements();

  const [draft, setDraft] = useState<UrlRule[]>(persistedRules);
  const [addOpen, setAddOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<UrlRule | null>(null);

  const maxRules = tier === 'free' ? FREE_RULE_LIMIT : Infinity;
  const atLimit = draft.length >= maxRules;

  // Saved groups only (exclude Now Open at index 0)
  const savedGroups = groupsState?.available.slice(1).filter((g) => !g.archived) ?? [];

  // One-time sweep of rules orphaned before deleteRulesForGroupIds existed (or from any other
  // gap) — self-heals on open rather than requiring a manual per-rule delete. Runs exactly once
  // (not on every groupsState refetch) so it never clobbers in-progress, unsaved draft edits.
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current || !groupsState) return;
    swept.current = true;
    const validIds = new Set(groupsState.available.map((g) => g.id));
    setDraft((prev) => {
      const cleaned = prev.filter((r) => validIds.has(r.groupId));
      if (cleaned.length !== prev.length) void saveRules(cleaned);
      return cleaned.length === prev.length ? prev : cleaned;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsState]);

  const handleAdd = (pattern: string, groupId: string) => {
    if (atLimit) {
      toast.error(`Free plan allows up to ${FREE_RULE_LIMIT} URL rules.`, {
        action: {
          label: 'Upgrade',
          onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` })
        }
      });
      return;
    }
    setDraft((prev) => [...prev, { id: nanoid(10), pattern, groupId, createdAt: Date.now() }]);
    setAddOpen(false);
  };

  const handleEdit = (pattern: string, groupId: string) => {
    if (!editingRule) return;
    setDraft((prev) => prev.map((r) => (r.id === editingRule.id ? { ...r, pattern, groupId } : r)));
    setEditingRule(null);
  };

  const deleteRule = (id: string) => setDraft((prev) => prev.filter((r) => r.id !== id));

  const reorder = (from: number, to: number) => {
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleSave = () => {
    saveRules(draft);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>URL Rules</DialogTitle>
        <DialogDescription>
          Auto-assign tabs to groups by URL pattern. Use <code>*</code> as a wildcard (e.g.{' '}
          <code>github.com/*</code>). First matching rule wins.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-2 max-h-52 overflow-y-auto pr-1">
        {draft.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No rules yet.</p>
        )}
        {draft.map((rule, i) => {
          const group = savedGroups.find((g) => g.id === rule.groupId);

          return (
            <div key={rule.id} className="flex items-center gap-2 text-xs bg-muted/40 px-2 py-1.5">
              <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 min-w-0 font-mono truncate" title={rule.pattern}>{rule.pattern}</span>
              <span className="flex items-center shrink-0 max-w-[120px]">
                {group && <GroupDot color={group.color} />}
                <span className="truncate" title={group?.name}>{group?.name ?? '(deleted group)'}</span>
              </span>
              <div className="flex items-center shrink-0 gap-0.5">
                <div className="flex flex-col">
                  <Button
                    variant="ghost" size="icon" className="h-5 w-5"
                    disabled={i === 0}
                    onClick={() => reorder(i, i - 1)}
                    aria-label="Move rule up"
                  ><ChevronUp className="h-3 w-3" /></Button>
                  <Button
                    variant="ghost" size="icon" className="h-5 w-5"
                    disabled={i === draft.length - 1}
                    onClick={() => reorder(i, i + 1)}
                    aria-label="Move rule down"
                  ><ChevronDown className="h-3 w-3" /></Button>
                </div>
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  onClick={() => setEditingRule(rule)}
                  aria-label="Edit rule"
                ><Pencil className="h-3 w-3" /></Button>
                <Button
                  variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive"
                  onClick={() => deleteRule(rule.id)}
                  aria-label="Delete rule"
                ><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-medium">
          {tier === 'free' && <span className="text-muted-foreground">{draft.length}/{FREE_RULE_LIMIT} used</span>}
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={atLimit}>
          <Plus className="h-3 w-3 mr-1" />Add rule
        </Button>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" aria-label="Discard changes" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save all rules" onClick={handleSave}>Save</Button>
      </DialogFooter>

      <AddUrlRuleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
        savedGroups={savedGroups}
      />
      <AddUrlRuleModal
        open={editingRule !== null}
        onClose={() => setEditingRule(null)}
        onSubmit={handleEdit}
        savedGroups={savedGroups}
        initialRule={editingRule ?? undefined}
      />
    </>
  );
}

interface AddUrlRuleModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (pattern: string, groupId: string) => void;
  savedGroups: Array<{ id: string; name: string; color: string }>;
  initialRule?: UrlRule;
}

function AddUrlRuleModal({ open, onClose, onSubmit, savedGroups, initialRule }: AddUrlRuleModalProps) {
  const isEdit = !!initialRule;
  const [pattern, setPattern] = useState(initialRule?.pattern ?? '');
  const [groupId, setGroupId] = useState(initialRule?.groupId ?? '');

  // Re-sync form fields whenever the modal opens (add: blank, edit: prefilled)
  useEffect(() => {
    if (open) {
      setPattern(initialRule?.pattern ?? '');
      setGroupId(initialRule?.groupId ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = pattern.trim();
  const unchanged = isEdit && trimmed === initialRule!.pattern && groupId === initialRule!.groupId;
  const disabled = !trimmed || !groupId || unchanged;

  const submit = () => {
    if (disabled) return;
    onSubmit(trimmed, groupId);
    if (!isEdit) {
      setPattern('');
      setGroupId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit URL Rule' : 'Add URL Rule'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          <Input
            placeholder="Pattern, e.g. github.com/*"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="text-xs h-8"
            autoFocus
          />
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue placeholder="Select target group…" />
            </SelectTrigger>
            <SelectContent>
              {savedGroups.map((g) => (
                <SelectItem key={g.id} value={g.id} className="text-xs">
                  <GroupDot color={g.color} />
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="mt-2">
          <Button size="sm" className="w-full" disabled={disabled} onClick={submit}>
            {isEdit ? 'Save' : 'Add rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
