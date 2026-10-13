import { describe, it, expect } from 'vitest'
import { TOUR_ANCHORS, TOUR_CHAPTERS, TOUR_STEPS } from '@/lib/tourSteps'

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

  it('keeps at least half of the steps read-only and gives every interactive step its texts', () => {
    const tasks = TOUR_STEPS.filter((s) => s.task)
    expect(tasks.length).toBeGreaterThanOrEqual(3)
    expect(tasks.length).toBeLessThanOrEqual(TOUR_STEPS.length / 2)
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

  it('has six chapters, 23 steps and one more (AI) when the flag is on', () => {
    expect(TOUR_CHAPTERS).toHaveLength(6)
    expect(TOUR_STEPS.filter((s) => s.when !== 'ai')).toHaveLength(23)
    expect(TOUR_STEPS.filter((s) => s.when === 'ai')).toHaveLength(1)
  })

  it('has exactly the five interactive steps', () => {
    expect(TOUR_STEPS.filter((s) => s.task).map((s) => s.task)).toEqual(['make-group', 'group-colour', 'group-pin', 'search', 'theme'])
  })

  it('never says "highlighted" in an interactive body (the ring is invisible to a screen reader)', () => {
    for (const step of TOUR_STEPS.filter((s) => s.task)) {
      expect(`${step.body} ${step.fallbackBody ?? ''} ${step.doneText ?? ''}`, step.id).not.toMatch(/highlighted|click here|this button/i)
    }
  })

  it('names each interactive step\'s controls in the order the action ring visits them', () => {
    const order: Record<string, string[]> = {
      'make-group': ['Add Group', 'Group name', 'Save'],
      'group-colour': ['Change group color', 'swatches', 'Apply'],
      'group-pin': ['star', 'Pin group'],
      search: ['Open search', 'search field'],
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
})
