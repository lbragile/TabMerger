import { describe, it, expect } from 'vitest'
import { PRESET_COLORS } from '@tabmerger/shared'
import { CHROME_GROUP_COLORS, chromeGroupColor, contrastRatio, readableTextColor, relativeLuminance } from '@/lib/color'

describe('readableTextColor', () => {
  it.each([...PRESET_COLORS])('text on the group colour %s reaches 4.5:1', (color) => {
    expect(contrastRatio(readableTextColor(color), color)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.keys(CHROME_GROUP_COLORS))('text on the Chrome tab-group colour "%s" reaches 4.5:1', (name) => {
    expect(contrastRatio(readableTextColor(name), chromeGroupColor(name))).toBeGreaterThanOrEqual(4.5)
  })

  it('picks black on light colours and white on dark ones', () => {
    expect(readableTextColor('yellow')).toBe('#000000')
    expect(readableTextColor('rgba(234, 179, 8, 1)')).toBe('#000000')
    expect(readableTextColor('rgba(15, 23, 42, 1)')).toBe('#ffffff')
    expect(readableTextColor('#5f6368')).toBe('#ffffff')
  })
})

describe('chromeGroupColor', () => {
  it("maps Chrome's colour names to Chrome's own colours, case-insensitively", () => {
    expect(chromeGroupColor('yellow')).toBe('#f9ab00')
    expect(chromeGroupColor('Cyan')).toBe('#007b83')
  })

  it('passes other colours through and falls back to grey', () => {
    expect(chromeGroupColor('rgba(1, 2, 3, 1)')).toBe('rgba(1, 2, 3, 1)')
    expect(chromeGroupColor(undefined)).toBe(CHROME_GROUP_COLORS.grey)
  })
})

describe('contrast helpers', () => {
  it('match the WCAG reference values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1)
    expect(relativeLuminance('#000000')).toBeCloseTo(0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})
