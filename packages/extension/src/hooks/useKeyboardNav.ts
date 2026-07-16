import { useEffect } from 'react'
import type React from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useAddGroup, useDeleteTab } from '@/hooks/useGroups'

export interface KeyboardNavOptions {
  groupCount: number
  /** String tab id passed by the caller when a tab is focused; hook deletes it on Del. */
  focusedTabId?: string | null
  /** Ref to the search input; if omitted, falls back to querySelector('header input'). */
  searchInputRef?: React.RefObject<HTMLElement | null>
}

const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditableTarget() {
  const el = document.activeElement
  if (!el) return false
  return SKIP_TAGS.has(el.tagName) || (el as HTMLElement).isContentEditable
}

/** Returns the groupIndex of the currently-focused sidebar group item, or null. */
function getFocusedSidebarGroupIndex(): number | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  const gi = el.dataset.sidebarGroupIndex
  return gi != null ? Number(gi) : null
}

/** Read positional data attrs off the currently-focused tab row, if any. */
function getFocusedTabInfo(): { groupIndex: number; windowIndex: number; tabIndex: number } | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  const gi = el.dataset.groupIndex
  const wi = el.dataset.windowIndex
  const ti = el.dataset.tabIndex
  if (gi == null || wi == null || ti == null) return null
  return { groupIndex: Number(gi), windowIndex: Number(wi), tabIndex: Number(ti) }
}

export function useKeyboardNav({ groupCount, focusedTabId, searchInputRef }: KeyboardNavOptions) {
  const { undo, redo } = useUndoRedo()
  const { mutate: addGroup } = useAddGroup()
  // ponytail: cast needed because tests pass a string id; real callers use the DOM fallback path
  const { mutate: deleteTabMutate } = useDeleteTab()
  const deleteTab = deleteTabMutate as unknown as (arg: unknown) => void
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex)
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex)
  const openModal = useUIStore((s) => s.openModal)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget()) return

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault()
            void undo()
            break
          case 'y':
            e.preventDefault()
            void redo()
            break
          case 'g':
            e.preventDefault()
            addGroup({})
            break
          case 'f': {
            e.preventDefault()
            const target: HTMLElement | null = searchInputRef?.current
              ?? document.querySelector<HTMLInputElement>('header input')
            target?.focus()
            break
          }
        }
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveGroupIndex(Math.min(activeGroupIndex + 1, groupCount - 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveGroupIndex(Math.max(activeGroupIndex - 1, 0))
        return
      }

      if (e.key === 'Enter') {
        const gi = getFocusedSidebarGroupIndex()
        if (gi != null) {
          e.preventDefault()
          setActiveGroupIndex(gi)
        }
        return
      }

      if (e.key === 'Delete') {
        // Caller-provided string id takes priority (used by tests and explicit-focus callers)
        if (focusedTabId != null) {
          e.preventDefault()
          deleteTab(focusedTabId)
          return
        }
        // Fall back: read data-* from focused DOM element
        const tabInfo = getFocusedTabInfo()
        if (tabInfo) {
          e.preventDefault()
          deleteTabMutate(tabInfo)
          return
        }
        // Delete focused sidebar group (never Now Open at index 0)
        const sgi = getFocusedSidebarGroupIndex()
        if (sgi != null && sgi > 0) {
          e.preventDefault()
          openModal('deleteGroup', { groupIndex: sgi })
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, addGroup, deleteTab, deleteTabMutate, activeGroupIndex, setActiveGroupIndex, groupCount, focusedTabId, searchInputRef, openModal])

  return { focusedGroupIndex: activeGroupIndex }
}
