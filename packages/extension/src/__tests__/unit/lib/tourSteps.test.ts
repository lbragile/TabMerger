import { describe, it, expect } from 'vitest'
import { TOUR_ANCHORS, TOUR_CHAPTERS, TOUR_STEPS } from '@/lib/tourSteps'
import { TOUR_DROP_LABELS, TOUR_MENU_LABELS, tourTask, type TourTaskContext } from '@/lib/tourTasks'
import { TOUR_DEMO_CHAPTERS } from '@/lib/tour'

const EMPTY_CTX: TourTaskContext = {
  groups: [],
  practiceGroupId: null,
  maxGroups: 5,
  renamingGroupIndex: null,
  searchFilter: '',
  theme: 'system',
  modalType: null,
  previewColor: null,
  practiceTab: { id: null, url: '', state: 'off' },
  signals: {},
  selectionMode: false,
  selectedIds: []
}

describe('TOUR_STEPS', () => {
  it('has unique ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('starts with a centered welcome step', () => {
    expect(TOUR_STEPS[0].anchor).toBeNull()
    expect(TOUR_STEPS[0].placement).toBe('center')
  })

  it('anchors every non-centered step on a known data-tour name', () => {
    const known = Object.values(TOUR_ANCHORS) as string[]
    for (const step of TOUR_STEPS) {
      if (step.anchor === null) expect(step.placement).toBe('center')
      else expect(known).toContain(step.anchor)
    }
  })

  it('has a non-empty title and body on every step', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.body.trim().length).toBeGreaterThan(0)
    }
  })

  it('mentions the AI features only in steps marked as behind the AI flag', () => {
    expect(TOUR_STEPS.some((s) => s.when === 'ai')).toBe(true)
    for (const step of TOUR_STEPS.filter((s) => s.when !== 'ai')) {
      expect(`${step.title} ${step.body} ${step.fallbackBody ?? ''} ${step.doneText ?? ''}`).not.toMatch(/\bAI\b|artificial|auto-?group|organi[sz]e/i)
    }
  })

  it('puts every step in a known chapter and keeps the steps of a chapter together', () => {
    const known = TOUR_CHAPTERS.map((c) => c.id)
    const order = TOUR_STEPS.map((s) => s.chapter)
    for (const id of order) expect(known).toContain(id)
    // a chapter never comes back after another one started
    expect(order.filter((id, i) => id !== order[i - 1])).toEqual(known)
  })

  it('keeps a read-only step in every chapter that has tasks and gives every interactive step its texts', () => {
    const tasks = TOUR_STEPS.filter((s) => s.task)
    expect(tasks.length).toBeGreaterThanOrEqual(3)
    // the orienting chapters stay a look; most of the rest is hands-on, never every step
    expect(tasks.length).toBeLessThan(TOUR_STEPS.length)
    expect(TOUR_STEPS.filter((s) => !s.task).length).toBeGreaterThanOrEqual(10)
    for (const step of tasks) expect(step.doneText?.trim().length).toBeGreaterThan(0)
  })

  it('gives no browser-level keyboard shortcut (they are not the same everywhere)', () => {
    for (const step of TOUR_STEPS) {
      expect(`${step.body} ${step.fallbackBody ?? ''}`).not.toMatch(/\b(Ctrl|Cmd|Command|Alt|Shift)\s*\+/i)
    }
  })

  it('gives every chapter a non-empty title and description, with unique ids', () => {
    for (const chapter of TOUR_CHAPTERS) {
      expect(chapter.title.trim().length, chapter.id).toBeGreaterThan(0)
      expect(chapter.description.trim().length, chapter.id).toBeGreaterThan(0)
    }
    expect(new Set(TOUR_CHAPTERS.map((c) => c.id)).size).toBe(TOUR_CHAPTERS.length)
  })

  it('has seven chapters, 26 steps and one more (AI) when the flag is on', () => {
    expect(TOUR_CHAPTERS).toHaveLength(7)
    expect(TOUR_STEPS.filter((s) => s.when !== 'ai')).toHaveLength(26)
    expect(TOUR_STEPS.filter((s) => s.when === 'ai')).toHaveLength(1)
  })

  it('has exactly the fifteen interactive steps, in order', () => {
    expect(TOUR_STEPS.filter((s) => s.task).map((s) => s.task)).toEqual([
      'make-group', 'group-color', 'group-pin', 'drag-tab-reorder', 'drag-tab-window', 'drag-tab-group', 'drag-group-order',
      'save-tabs', 'open-tabs', 'tidy-up', 'select-items', 'search', 'search-filters', 'undo', 'theme'
    ])
  })

  it('never says "highlighted" in an interactive body (the ring is invisible to a screen reader)', () => {
    for (const step of TOUR_STEPS.filter((s) => s.task)) {
      expect(`${step.body} ${step.fallbackBody ?? ''} ${step.doneText ?? ''}`, step.id).not.toMatch(/highlighted|click here|this button/i)
    }
  })

  it('names each interactive step\'s controls in the order the action ring visits them', () => {
    const order: Record<string, string[]> = {
      'make-group': ['Add Group', 'Group name', 'Save'],
      'group-color': ['Change group color', 'swatches', 'Apply'],
      'group-pin': ['star', 'Pin group'],
      theme: ['Settings menu', '"Settings"', '"Theme"', 'Save changes']
    }
    for (const [id, names] of Object.entries(order)) {
      const body = TOUR_STEPS.find((s) => s.id === id)!.body
      const at = names.map((n) => body.indexOf(n))
      for (const i of at) expect(i, `${id}: ${names[at.indexOf(i)]}`).toBeGreaterThanOrEqual(0)
      expect([...at].sort((a, b) => a - b), id).toEqual(at)
    }
  })

  it('mentions no keyboard shortcut beyond Enter, Space and the arrow keys', () => {
    for (const step of TOUR_STEPS) {
      const text = `${step.body} ${step.fallbackBody ?? ''} ${step.doneText ?? ''}`
      expect(text, step.id).not.toMatch(/\b(Ctrl|Cmd|Command|Alt|Option|Shift|Esc|Escape|Backspace|PageUp|PageDown)\b|\bF\d{1,2}\b/)
      for (const match of text.matchAll(/\bpress(?:ing)?\s+(?:the\s+)?([A-Z][a-z]+)/g)) expect(['Enter', 'Space'], `${step.id}: ${match[0]}`).toContain(match[1])
    }
  })

  it('ends on the help button, so the last step points at how to replay', () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1]
    expect(last.anchor).toBe(TOUR_ANCHORS.help)
  })

  it('uses no British spellings the app does not use', () => {
    const all = [...TOUR_STEPS.flatMap((s) => [s.title, s.body, s.fallbackBody, s.doneText, s.modalBody, ...(s.subStepText ?? []), ...(s.subStepKeys ?? [])]), ...TOUR_CHAPTERS.flatMap((c) => [c.title, c.description])]
    for (const text of all.filter(Boolean) as string[]) {
      expect(text).not.toMatch(/(organis\w*|colour\w*|favour\w*|grey|centre|behaviour|licence|cancelled|customis\w*)/i)
    }
  })

  it('never names the browser-level search shortcut "Ctrl+K" anywhere', () => {
    for (const step of TOUR_STEPS) {
      const text = [step.title, step.body, step.fallbackBody, step.doneText, step.modalBody, ...(step.subStepText ?? []), ...(step.subStepKeys ?? [])].join(' ')
      expect(text, step.id).not.toMatch(/Ctrl\s*\+?\s*K|Cmd\s*\+?\s*K/i)
    }
  })

  it('every drag step names its drop label in each sub-step that moves, and gives a key line per sub-step', () => {
    const labels = Object.values(TOUR_DROP_LABELS)
    for (const step of TOUR_STEPS.filter((s) => s.task?.startsWith('drag-') || s.task === 'save-tabs')) {
      expect(step.subStepText?.length, step.id).toBe(3)
      expect(step.subStepKeys?.length, step.id).toBe(3)
      // the middle sub-step is the move: it quotes the exact words on the marker
      const label = labels.find((l) => step.subStepText![1].includes(`"${l}"`))
      expect(label, `${step.id}: sub-step 2 quotes a drop label`).toBeTruthy()
      expect(step.subStepKeys![1], step.id).toContain(`"${label}"`)
      // the label text is also the one the task draws
      const task = tourTask(step.task!)!
      expect(task.targets({ ...EMPTY_CTX }).dropLabel ?? label).toBe(label)
    }
  })

  it('quotes the menu labels the tasks look for', () => {
    const open = TOUR_STEPS.find((s) => s.id === 'open-tabs')!
    expect(open.subStepText!.join(' ')).toContain(`"${TOUR_MENU_LABELS.openWindow}"`)
    const tidy = TOUR_STEPS.find((s) => s.id === 'tidy-up')!
    expect(tidy.subStepText!.join(' ')).toContain(`"${TOUR_MENU_LABELS.deduplicate}"`)
  })

  it('every task step has sub-step text when its task visits several controls', () => {
    for (const step of TOUR_STEPS.filter((s) => s.task)) {
      const count = tourTask(step.task!)?.subSteps
      if (count && step.subStepText) expect(step.subStepText.length, step.id).toBeLessThanOrEqual(count)
    }
  })

  it('puts each demo chapter step on the practice groups and no other chapter', () => {
    const demo = TOUR_STEPS.filter((s) => s.activate === 'tour-demo').map((s) => s.chapter)
    for (const c of demo) expect(TOUR_DEMO_CHAPTERS).toContain(c)
    expect([...TOUR_DEMO_CHAPTERS].sort()).toEqual(['drag', 'find', 'tabs'])
  })
})
