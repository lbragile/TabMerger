'use client'

import { useEffect, useRef, useState } from 'react'
import type { DeviceSession } from '@tabmerger/shared'
import { isEncryptedBlob, decryptBlob } from '@tabmerger/shared'
import { useEncryptionKey } from '@/lib/encryption/context'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Laptop, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

/** device_sessions row shape as returned by Supabase — DeviceSession (shared) plus its primary key. */
type DeviceRow = DeviceSession & { id: string }

interface DevicesSectionProps {
  initialDevices: DeviceRow[]
  userId: string
}

// ponytail: now_open_snapshot is `unknown` (jsonb, loose so malformed rows don't
// throw) — narrow it defensively rather than trusting a shape. Mirrors the
// extension's OtherDevices.tsx snapshotTabs()/snapshotWindowCount() pattern.
function snapshotCounts(snapshot: unknown): { windows: number; tabs: number } {
  if (!snapshot || typeof snapshot !== 'object') return { windows: 0, tabs: 0 }
  const windows = (snapshot as { windows?: unknown }).windows
  if (!Array.isArray(windows)) return { windows: 0, tabs: 0 }
  const tabs = windows.reduce((sum, w) => {
    const t = (w as { tabs?: unknown })?.tabs
    return sum + (Array.isArray(t) ? t.length : 0)
  }, 0)
  return { windows: windows.length, tabs }
}

/** Formats an ISO timestamp as "3 minutes ago" / "2 days ago", falling back to a date for anything over a month old. */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}

export function DevicesSection({ initialDevices, userId }: DevicesSectionProps) {
  const { dataKey } = useEncryptionKey()
  const [devices, setDevices] = useState(initialDevices)

  // Decrypt any encrypted now_open_snapshot blobs once a data key is available. Rows that
  // can't be decrypted (locked, or no encryption) fall through to snapshotCounts() below,
  // which already degrades to "no count shown" for a non-array `windows` — same graceful
  // path used for genuinely malformed rows, no separate "locked" UI needed.
  useEffect(() => {
    if (!dataKey) return
    let cancelled = false
    ;(async () => {
      const next = await Promise.all(
        initialDevices.map(async (d) => {
          if (!isEncryptedBlob(d.now_open_snapshot)) return d
          try {
            const content = await decryptBlob<{ windows: unknown }>(dataKey, d.now_open_snapshot)
            return { ...d, now_open_snapshot: content }
          } catch {
            return d
          }
        })
      )
      if (!cancelled) setDevices(next)
    })()
    return () => {
      cancelled = true
    }
  }, [dataKey, initialDevices])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeviceRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const editingInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  // Radix's dropdown restores focus to the "⋮" trigger on close, which races with
  // (and can steal focus right back from) the rename Input's autoFocus below. Focusing
  // in a plain effect runs after that restore, so ours always wins.
  useEffect(() => {
    if (!editingId) return
    const raf = requestAnimationFrame(() => editingInputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [editingId])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.length === devices.length ? [] : devices.map((d) => d.id)))
  }

  function startRename(device: DeviceRow) {
    setEditingId(device.id)
    setEditingName(device.device_name)
  }

  async function saveRename(device: DeviceRow) {
    const name = editingName.trim()
    setEditingId(null)
    if (!name || name === device.device_name) return

    setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, device_name: name } : d)))
    const { error } = await supabase
      .from('device_sessions')
      .update({ device_name: name })
      .eq('id', device.id)
      .eq('user_id', userId)

    if (error) {
      toast.error('Failed to rename device')
      setDevices((prev) => prev.map((d) => (d.id === device.id ? device : d)))
      return
    }
    toast.success('Device renamed')
  }

  async function confirmDelete() {
    const device = deleteTarget
    if (!device) return
    setDeleteTarget(null)

    const prevDevices = devices
    setDevices((prev) => prev.filter((d) => d.id !== device.id))
    const { error } = await supabase
      .from('device_sessions')
      .delete()
      .eq('id', device.id)
      .eq('user_id', userId)

    if (error) {
      toast.error('Failed to remove device')
      setDevices(prevDevices)
      return
    }
    toast.success('Device removed')
  }

  async function confirmBulkDelete() {
    const ids = selectedIds
    setBulkDeleteOpen(false)

    const prevDevices = devices
    setDevices((prev) => prev.filter((d) => !ids.includes(d.id)))
    setSelectedIds([])
    const { error } = await supabase.from('device_sessions').delete().in('id', ids).eq('user_id', userId)

    if (error) {
      toast.error('Failed to remove devices')
      setDevices(prevDevices)
      return
    }
    toast.success(`${ids.length} device${ids.length === 1 ? '' : 's'} removed`)
  }

  return (
    <>
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No devices yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {selectedIds.length > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.length === devices.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all devices"
                />
                {selectedIds.length} selected
              </label>
              <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                Remove {selectedIds.length} device{selectedIds.length === 1 ? '' : 's'}
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
          {devices.map((device) => (
            <div key={device.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <input
                type="checkbox"
                checked={selectedIds.includes(device.id)}
                onChange={() => toggleSelected(device.id)}
                aria-label={`Select ${device.device_name}`}
              />
              <Laptop className="h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1 min-w-0 -ml-1.5">
                {editingId === device.id ? (
                  <Input
                    ref={editingInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => saveRename(device)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(device)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-8 max-w-xs"
                  />
                ) : (
                  <p className="text-sm font-medium truncate">{device.device_name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Active {formatRelativeTime(device.last_active)}
                  {(() => {
                    const { windows, tabs } = snapshotCounts(device.now_open_snapshot)
                    return windows > 0 ? ` · ${windows} window${windows === 1 ? '' : 's'} · ${tabs} tab${tabs === 1 ? '' : 's'}` : ''
                  })()}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Device options">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => startRename(device)} className="gap-2">
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onClick={() => setDeleteTarget(device)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          </div>
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove device?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${deleteTarget.device_name}" will no longer sync tab data. This can't be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {selectedIds.length} devices?</DialogTitle>
            <DialogDescription>
              These devices will no longer sync tab data. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmBulkDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
