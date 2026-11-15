import { describe, it, expect } from 'vitest'
import { AUTO_ITEM_COLORS, PRESET_COLORS, colorForId, isAutoItemColor } from '@tabmerger/shared'
import { autoColorName, sessionDisplayColor, validSessionColor, withValidSessionColor } from '@/lib/sessionColor'

describe('isAutoItemColor / validSessionColor', () => {
  it('accepts exactly the ten palette colours', () => {
    expect(AUTO_ITEM_COLORS).toHaveLength(10)
    for (const c of AUTO_ITEM_COLORS) {
      expect(isAutoItemColor(c)).toBe(true)
      expect(validSessionColor(c)).toBe(c)
    }
  })

  it.each([['rgba(107, 114, 128, 1)'], ['rgba(15, 23, 42, 1)'], ['rgba(239,68,68,1)'], ['#ef4444'], ['red'], [''], [null], [undefined], [7], [{}]])(
    'rejects %s (neutral presets, other spellings, non-strings)',
    (value) => {
      expect(isAutoItemColor(value)).toBe(false)
      expect(validSessionColor(value)).toBeUndefined()
    }
  )

  it('the two neutral presets are not in the palette', () => {
    expect(PRESET_COLORS.filter((c) => !isAutoItemColor(c))).toEqual(['rgba(107, 114, 128, 1)', 'rgba(15, 23, 42, 1)'])
  })
})

describe('withValidSessionColor', () => {
  it('keeps a valid colour and returns the same object', () => {
    const s = { id: 'a', color: AUTO_ITEM_COLORS[2] }
    expect(withValidSessionColor(s)).toBe(s)
  })

  it('returns the same object when there is no colour', () => {
    const s: { id: string; color?: string } = { id: 'a' }
    expect(withValidSessionColor(s)).toBe(s)
  })

  it('drops an invalid colour and keeps everything else', () => {
    const s = { id: 'a', name: 'n', color: 'url(javascript:alert(1))' }
    const out = withValidSessionColor(s)
    expect(out).toEqual({ id: 'a', name: 'n' })
    expect('color' in out).toBe(false)
  })
})

describe('colorForId / sessionDisplayColor', () => {
  it('is stable for an id and always a palette colour', () => {
    for (const id of ['a', 'abc123XYZ_', 'session-1', '', 'ñ😀']) {
      expect(colorForId(id)).toBe(colorForId(id))
      expect(isAutoItemColor(colorForId(id))).toBe(true)
    }
  })

  it('spreads ids over several colours', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => colorForId(`id-${i}`)))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('uses the stored colour when valid, else the id colour (nothing written back)', () => {
    expect(sessionDisplayColor({ id: 'x', color: AUTO_ITEM_COLORS[7] })).toBe(AUTO_ITEM_COLORS[7])
    expect(sessionDisplayColor({ id: 'x' })).toBe(colorForId('x'))
    expect(sessionDisplayColor({ id: 'x', color: 'rgba(0, 0, 0, 1)' })).toBe(colorForId('x'))
  })
})

describe('autoColorName', () => {
  it('names each palette colour in order', () => {
    expect(AUTO_ITEM_COLORS.map(autoColorName)).toEqual(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'teal'])
  })

  it('has no name for other colours', () => {
    expect(autoColorName('rgba(107, 114, 128, 1)')).toBeUndefined()
  })
})
