import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, ChevronUp, ChevronDown, Link } from 'lucide-react';
import { useGroups } from '@/hooks/useGroups';
import { useUrlRules, useAddUrlRule, useDeleteUrlRule, useReorderUrlRule } from '@/hooks/useUrlRules';
import { useEntitlements } from '@/hooks/useEntitlements';
import { toast } from 'sonner';

const FREE_RULE_LIMIT = 3;

interface UrlRulesModalProps {
  onClose: () => void;
}

export function UrlRulesModal({ onClose: _onClose }: UrlRulesModalProps) {
  const { data: groupsState } = useGroups();
  const { data: rules = [] } = useUrlRules();
  const { mutate: addRule } = useAddUrlRule();
  const { mutate: deleteRule } = useDeleteUrlRule();
  const { mutate: reorder } = useReorderUrlRule();
  const { tier } = useEntitlements();

  const [pattern, setPattern] = useState('');
  const [groupId, setGroupId] = useState('');

  const maxRules = tier === 'free' ? FREE_RULE_LIMIT : Infinity;
  const atLimit = rules.length >= maxRules;

  // Saved groups only (exclude Now Open at index 0)
  const savedGroups = groupsState?.available.slice(1).filter((g) => !g.archived) ?? [];

  const handleAdd = () => {
    const trimmed = pattern.trim();
    if (!trimmed || !groupId) return;
    if (atLimit) {
      toast.error(`Free plan allows up to ${FREE_RULE_LIMIT} URL rules.`, {
        action: {
          label: 'Upgrade',
          onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` })
        }
      });
      return;
    }
    addRule({ pattern: trimmed, groupId });
    setPattern('');
    setGroupId('');
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
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No rules yet.</p>
        )}
        {rules.map((rule, i) => {
          const group = savedGroups.find((g) => g.id === rule.groupId);
          return (
            <div key={rule.id} className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-2 py-1.5">
              <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-mono truncate" title={rule.pattern}>{rule.pattern}</span>
              <span className="shrink-0 text-muted-foreground">→</span>
              <span className="shrink-0 max-w-[100px] truncate" title={group?.name}>{group?.name ?? '(deleted group)'}</span>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  disabled={i === 0}
                  onClick={() => reorder({ from: i, to: i - 1 })}
                  aria-label="Move rule up"
                ><ChevronUp className="h-3 w-3" /></Button>
                <Button
                  variant="ghost" size="icon" className="h-5 w-5"
                  disabled={i === rules.length - 1}
                  onClick={() => reorder({ from: i, to: i + 1 })}
                  aria-label="Move rule down"
                ><ChevronDown className="h-3 w-3" /></Button>
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

      {/* Add rule form */}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium">Add rule {tier === 'free' && <span className="text-muted-foreground">({rules.length}/{FREE_RULE_LIMIT} used)</span>}</p>
        <Input
          placeholder="Pattern, e.g. github.com/*"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="text-xs h-8"
        />
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="text-xs h-8">
            <SelectValue placeholder="Select target group…" />
          </SelectTrigger>
          <SelectContent>
            {savedGroups.map((g) => (
              <SelectItem key={g.id} value={g.id} className="text-xs">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ background: g.color }}
                />
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm" className="w-full"
          disabled={!pattern.trim() || !groupId || atLimit}
          onClick={handleAdd}
        >
          Add rule
        </Button>
      </div>
    </>
  );
}
