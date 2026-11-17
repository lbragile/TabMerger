import { describe, it, expect, beforeEach } from 'vitest'
import { announceSectionView, clearSectionViewStatus, getSectionViewStatus, subscribeSectionViewStatus } from '@/lib/sectionViewStatus'

describe('section status line: repeats are announced again', () => {
  beforeEach(() => clearSectionViewStatus())

  it('the same message twice changes the text (a live region only speaks on a change), and back on a third time', () => {
    announceSectionView('3 matches')
    const first = getSectionViewStatus()
    announceSectionView('3 matches')
    const second = getSectionViewStatus()
    announceSectionView('3 matches')
    expect(first).toBe('3 matches')
    expect(second).not.toBe(first)
    expect(second.trim()).toBe('3 matches')
    expect(getSectionViewStatus()).toBe('3 matches')
  })

  it('every announcement notifies listeners', () => {
    let calls = 0
    const stop = subscribeSectionViewStatus(() => calls++)
    announceSectionView('Saved')
    announceSectionView('Saved')
    stop()
    expect(calls).toBe(2)
  })

  it('a conditional clear still recognises a repeated message', () => {
    announceSectionView('Showing tabs closed today')
    announceSectionView('Showing tabs closed today')
    clearSectionViewStatus('Showing tabs closed today')
    expect(getSectionViewStatus()).toBe('')
  })

  it('a different message is written as it is', () => {
    announceSectionView('A')
    announceSectionView('B')
    expect(getSectionViewStatus()).toBe('B')
  })
})
