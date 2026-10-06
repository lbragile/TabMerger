import { describe, it, expect } from 'vitest'
import { parseRgba, formatRgba, isValidHexColor, hexToRgba, rgbaToHex, withAlpha } from '@/lib/color'

describe('parseRgba / formatRgba', () => {
  it('parses an rgba string, ignoring alpha', () => {
    expect(parseRgba('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('parses a plain rgb string', () => {
    expect(parseRgba('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('formats as opaque, matching PRESET_COLORS style', () => {
    expect(formatRgba({ r: 239, g: 68, b: 68 })).toBe('rgba(239, 68, 68, 1)')
  })
})

describe('withAlpha', () => {
  it('swaps the alpha of an rgba group colour', () => {
    expect(withAlpha('rgba(239, 68, 68, 1)', 0.1)).toBe('rgba(239, 68, 68, 0.1)')
    expect(withAlpha('rgba(59,130,246,1)', 0.25)).toBe('rgba(59, 130, 246, 0.25)')
  })

  it('adds an alpha to a plain rgb colour', () => {
    expect(withAlpha('rgb(10, 20, 30)', 0.18)).toBe('rgba(10, 20, 30, 0.18)')
  })

  it('mixes any other CSS colour with transparent instead of returning it opaque', () => {
    expect(withAlpha('#ff0000', 0.1)).toBe('color-mix(in srgb, #ff0000 10%, transparent)')
    expect(withAlpha('rebeccapurple', 0.07)).toBe('color-mix(in srgb, rebeccapurple 7%, transparent)')
  })
})

describe('isValidHexColor', () => {
  it('accepts 3- and 6-digit hex', () => {
    expect(isValidHexColor('#abc')).toBe(true)
    expect(isValidHexColor('#aabbcc')).toBe(true)
  })

  it('rejects invalid lengths, alpha hex, and non-hex characters', () => {
    expect(isValidHexColor('#ab')).toBe(false)
    expect(isValidHexColor('#abcd')).toBe(false)
    expect(isValidHexColor('#aabbccdd')).toBe(false)
    expect(isValidHexColor('not-a-color')).toBe(false)
  })
})

describe('hexToRgba', () => {
  it('converts a 6-digit hex to opaque rgba', () => {
    expect(hexToRgba('#ff0000')).toBe('rgba(255, 0, 0, 1)')
  })

  it('expands shorthand 3-digit hex', () => {
    expect(hexToRgba('#f00')).toBe('rgba(255, 0, 0, 1)')
  })
})

describe('rgbaToHex', () => {
  it('produces a plain 6-digit hex', () => {
    expect(rgbaToHex('rgba(255, 0, 0, 1)')).toBe('#ff0000')
  })

  it('ignores any alpha channel present (legacy/imported data) instead of crashing', () => {
    expect(rgbaToHex('rgba(1, 2, 3, 0.4)')).toBe('#010203')
  })

  it('round-trips hex -> rgba -> hex', () => {
    expect(rgbaToHex(hexToRgba('#3b82f6'))).toBe('#3b82f6')
  })
})
