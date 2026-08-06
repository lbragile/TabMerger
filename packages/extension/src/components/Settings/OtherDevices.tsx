import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceSession } from '@tabmerger/shared';
import { useEntitlements } from '@/hooks/useEntitlements';
import { fetchOtherDeviceSessions, renameDevice, removeDevices, getOrCreateDeviceId } from '@/lib/deviceSessions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { ChevronDown, ChevronRight, ExternalLink, Laptop } from 'lucide-react';

// ponytail: Supabase '*' select returns `id` (the row's primary key) but the shared DeviceSession
// type omits it (device_id is the app-level identity used everywhere else). Extend locally rather
// than widening the shared type for a field only the remove-flow needs — mirrors the web app's
// DevicesSection.tsx `DeviceRow` pattern.
type DeviceSessionRow = DeviceSession & { id: string };

/** Formats elapsed time as a short "Xm ago" / "Xh ago" / "Xd ago" label. */
function relativeAgo(iso: string, now = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (elapsed < MIN) return 'just now';
  if (elapsed < HOUR) return `${Math.round(elapsed / MIN)}m ago`;
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)}h ago`;
  return `${Math.round(elapsed / DAY)}d ago`;
}

// ponytail: DeviceSession.now_open_snapshot is `unknown` (jsonb, loose so malformed
// rows don't throw) — narrow it defensively rather than trusting a shape.
interface SnapshotTab {
  title?: string;
  url?: string;
  favIconUrl?: string;
}

function snapshotTabs(snapshot: unknown): SnapshotTab[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const windows = (snapshot as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((w) => {
    const tabs = (w as { tabs?: unknown })?.tabs;
    return Array.isArray(tabs) ? (tabs as SnapshotTab[]) : [];
  });
}

/** Window count for the snapshot — sibling to snapshotTabs() since callers need both. */
function snapshotWindowCount(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const windows = (snapshot as { windows?: unknown }).windows;
  return Array.isArray(windows) ? windows.length : 0;
}

/**
 * "Continue on other device" Settings panel — lists this account's other devices
 * (own device excluded) with their last-known Now Open tabs. Opening a tab is a
 * local, read-only handoff via chrome.tabs.create; nothing is written back to
 * Supabase or to the remote device's row. "Restore N tabs" in the expanded
 * list is the same handoff batched across every tab in the snapshot.
 */
export function OtherDevices() {
  const { tier } = useEntitlements();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: devices = [] } = useQuery({
    queryKey: ['otherDeviceSessions', tier],
    queryFn: () => fetchOtherDeviceSessions(tier) as Promise<DeviceSessionRow[]>,
    enabled: tier !== 'free',
    staleTime: 30_000
  });

  useQuery({
    queryKey: ['ownDeviceName'],
    queryFn: async () => {
      const id = await getOrCreateDeviceId();
      setDeviceName((prev) => prev || id);
      return id;
    },
    enabled: tier !== 'free'
  });

  if (tier === 'free') return null;

  const handleRename = () => {
    const trimmed = deviceName.trim();
    if (trimmed) renameDevice(trimmed);
  };

  const openTab = (tab: SnapshotTab) => {
    if (!tab.url) return;
    chrome.tabs.create({ url: tab.url });
  };

  // ponytail: same local read-only handoff as openTab, just batched — restoring a
  // device's whole session is not a new sync direction, so no window-grouping
  // logic is warranted (snapshot is a flat {title,url,favIconUrl} list, no Chrome
  // group/window metadata worth preserving).
  const restoreDevice = (tabs: SnapshotTab[]) => {
    tabs.forEach((tab) => {
      if (tab.url) chrome.tabs.create({ url: tab.url });
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleConfirmRemove = async () => {
    setConfirmOpen(false);
    const ids = selectedIds;
    setSelectedIds([]);
    await removeDevices(ids);
    queryClient.invalidateQueries({ queryKey: ['otherDeviceSessions', tier] });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="this-device-name">This device name</Label>
        <Input
          id="this-device-name"
          aria-label="This device name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
          }}
          onBlur={handleRename}
          className="h-8 text-xs"
        />
      </div>

      <div>
        <p className="text-xs font-medium mb-1.5">Other devices</p>
        {devices.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No other devices yet.</p>
        ) : (
          <>
            {selectedIds.length > 0 && (
              <div className="flex items-center justify-between gap-2 border border-border bg-muted/50 px-2 py-1.5 mb-1.5 text-xs">
                <span>{selectedIds.length} selected</span>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setConfirmOpen(true)}
                >
                  Remove
                </Button>
              </div>
            )}
            <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
              {devices.map((device) => (
                <DeviceRow
                  key={device.device_id}
                  device={device}
                  isExpanded={expanded === device.device_id}
                  isSelected={selectedIds.includes(device.id)}
                  onToggle={() => setExpanded((prev) => (prev === device.device_id ? null : device.device_id))}
                  onToggleSelected={() => toggleSelected(device.id)}
                  onOpenTab={openTab}
                  onRestoreAll={restoreDevice}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {selectedIds.length} device{selectedIds.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              Removed devices stop appearing in this list. If that browser is still active it may
              re-register itself the next time it syncs, so this isn&apos;t permanent for a live device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DeviceRowProps {
  device: DeviceSession;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onToggleSelected: () => void;
  onOpenTab: (tab: SnapshotTab) => void;
  onRestoreAll: (tabs: SnapshotTab[]) => void;
}

function DeviceRow({ device, isExpanded, isSelected, onToggle, onToggleSelected, onOpenTab, onRestoreAll }: DeviceRowProps) {
  const tabs = snapshotTabs(device.now_open_snapshot);
  const windowCount = snapshotWindowCount(device.now_open_snapshot);

  return (
    <div className="border border-border">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${device.device_name}`}
          className="shrink-0"
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 text-xs text-left"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="flex-1 min-w-0 flex items-center gap-1">
            <Laptop className="h-3 w-3 shrink-0 text-primary" />
            <span className="min-w-0 truncate font-medium">{device.device_name}</span>
          </span>
          <span className="text-muted-foreground shrink-0">{relativeAgo(device.last_active)}</span>
          <span className="text-muted-foreground shrink-0 truncate">
            {windowCount} {windowCount === 1 ? 'window' : 'windows'} · {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
          </span>
        </button>
      </div>
      {isExpanded && (
        <div className="border-t border-border px-2 py-1.5 space-y-1">
          {tabs.length === 0 && <p className="text-xs text-muted-foreground">No tabs.</p>}
          {tabs.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onRestoreAll(tabs)}
              >
                Restore {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
              </Button>
            </div>
          )}
          {tabs.map((tab, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate" title={tab.title ?? tab.url}>
                {tab.title || tab.url}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs shrink-0"
                aria-label="Open"
                onClick={() => onOpenTab(tab)}
              >
                <ExternalLink className="h-3 w-3 mr-1" />Open
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
