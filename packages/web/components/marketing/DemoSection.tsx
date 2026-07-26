'use client'

import { useState } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import type { Group } from '@tabmerger/shared'
import { PRESET_COLORS, DEFAULT_WINDOW_TITLE } from '@tabmerger/shared'

// ponytail: shared DEFAULT_GROUP_TITLE is 'New' (extension's AddGroup modal placeholder), not
// what the popup's sidebar "+" button actually names a fresh group — use the literal here.
const NEW_GROUP_NAME = 'New Group'
import { DemoHeader } from './demo/DemoHeader'
import { DemoSidebar } from './demo/DemoSidebar'
import { DemoWindowsPanel } from './demo/DemoWindowsPanel'
import { INITIAL_GROUPS, nextTabId, nextGroupId } from './demo/seedData'

export function DemoSection() {
  const [groups, setGroups] = useState<Group[]>(INITIAL_GROUPS)
  const [activeGroupId, setActiveGroupId] = useState<string>('work')
  const [autoRenameGroupId, setAutoRenameGroupId] = useState<string | null>(null)

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  function selectGroup(id: string) {
    setActiveGroupId(id)
  }

  function renameGroup(id: string, name: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)))
    setAutoRenameGroupId(null)
  }

  function addGroup() {
    const id = nextGroupId()
    const color = PRESET_COLORS[groups.length % PRESET_COLORS.length]
    setGroups((prev) => [
      ...prev,
      {
        id,
        name: NEW_GROUP_NAME,
        color,
        updatedAt: Date.now(),
        windows: [{ id: nextTabId(), tabs: [], incognito: false, focused: false, name: DEFAULT_WINDOW_TITLE }],
      },
    ])
    setActiveGroupId(id)
    setAutoRenameGroupId(id)
  }

  function toggleWindowStar(groupId: string, windowId: number) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, windows: g.windows.map((w) => (w.id !== windowId ? w : { ...w, starred: !w.starred })) }
      )
    )
  }

  function renameWindow(groupId: string, windowId: number, name: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId ? g : { ...g, windows: g.windows.map((w) => (w.id !== windowId ? w : { ...w, name })) }
      )
    )
  }

  function deleteWindow(groupId: string, windowId: number) {
    setGroups((prev) =>
      prev.map((g) => (g.id !== groupId ? g : { ...g, windows: g.windows.filter((w) => w.id !== windowId) }))
    )
  }

  function deleteTab(groupId: string, windowId: number, tabId: number) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g
        return {
          ...g,
          windows: g.windows.map((w) => (w.id !== windowId ? w : { ...w, tabs: w.tabs.filter((t) => t.id !== tabId) })),
        }
      })
    )
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)

    if (activeId.startsWith('group-') && overId.startsWith('group-')) {
      setGroups((prev) => {
        const ids = prev.map((g) => `group-${g.id}`)
        const oldIndex = ids.indexOf(activeId)
        const newIndex = ids.indexOf(overId)
        // Now Open always stays first, mirroring the real popup's sidebar ordering rule
        if (prev[oldIndex]?.permanent || prev[newIndex]?.permanent) return prev
        return arrayMove(prev, oldIndex, newIndex)
      })
      return
    }

    if (activeId.startsWith('window-') && overId.startsWith('window-')) {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== activeGroupId) return g
          const ids = g.windows.map((w) => `window-${w.id}`)
          const oldIndex = ids.indexOf(activeId)
          const newIndex = ids.indexOf(overId)
          if (oldIndex === -1 || newIndex === -1) return g
          return { ...g, windows: arrayMove(g.windows, oldIndex, newIndex) }
        })
      )
      return
    }

    if (activeId.startsWith('tab-') && overId.startsWith('tab-')) {
      // format: tab-{windowId}-{tabId} — only reorder if both belong to the same window
      const [, activeWindowId] = activeId.split('-')
      const [, overWindowId] = overId.split('-')
      if (activeWindowId !== overWindowId) return
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== activeGroupId) return g
          return {
            ...g,
            windows: g.windows.map((w) => {
              if (String(w.id) !== activeWindowId) return w
              const ids = w.tabs.map((t) => `tab-${w.id}-${t.id}`)
              const oldIndex = ids.indexOf(activeId)
              const newIndex = ids.indexOf(overId)
              if (oldIndex === -1 || newIndex === -1) return w
              return { ...w, tabs: arrayMove(w.tabs, oldIndex, newIndex) }
            }),
          }
        })
      )
    }
  }

  return (
    <div className="overflow-hidden mx-auto rounded-xl shadow-2xl w-full md:w-[585px] max-w-full h-[350px] md:h-[450px]">
      <div className="origin-top-left scale-45 md:scale-75 flex flex-col overflow-hidden" style={{ width: 780, height: 600 }}>
        <DemoHeader />
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex flex-1 min-h-0">
            <DemoSidebar
              groups={groups}
              activeGroupId={activeGroup.id}
              sortableIds={groups.map((g) => `group-${g.id}`)}
              onSelect={selectGroup}
              onRename={renameGroup}
              onAddGroup={addGroup}
              autoRenameGroupId={autoRenameGroupId}
            />
            <DemoWindowsPanel
              group={activeGroup}
              windowSortableIds={activeGroup.windows.map((w) => `window-${w.id}`)}
              onWindowStarToggle={(windowId) => toggleWindowStar(activeGroup.id, windowId)}
              onWindowDelete={(windowId) => deleteWindow(activeGroup.id, windowId)}
              onWindowRename={(windowId, name) => renameWindow(activeGroup.id, windowId, name)}
              onTabDelete={(windowId, tabId) => deleteTab(activeGroup.id, windowId, tabId)}
            />
          </div>
        </DndContext>
      </div>
    </div>
  )
}
