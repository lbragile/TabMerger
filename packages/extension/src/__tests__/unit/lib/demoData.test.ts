import { describe, it, expect } from 'vitest'
import { demoData } from '@/lib/demoData'

describe('demoData fixture', () => {
  it('exposes a valid GroupsState shape with at least one group', () => {
    expect(demoData.available.length).toBeGreaterThan(0)
    expect(demoData.active).toBeDefined()
    for (const g of demoData.available) {
      expect(typeof g.id).toBe('string')
      for (const w of g.windows) {
        for (const t of w.tabs) {
          expect(t.url).toMatch(/^https?:\/\//)
        }
      }
    }
  })
})
