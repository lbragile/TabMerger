import { afterEach, describe, expect, it } from 'vitest'
import { documentDirection, inlineArrow, isRtl } from '@/lib/direction'

afterEach(() => {
  document.documentElement.dir = ''
})

describe('documentDirection / isRtl', () => {
  it('reads <html dir> at the moment of the call', () => {
    expect(documentDirection()).toBe('ltr')
    expect(isRtl()).toBe(false)
    document.documentElement.dir = 'rtl'
    expect(documentDirection()).toBe('rtl')
    expect(isRtl()).toBe(true)
    document.documentElement.dir = 'ltr'
    expect(isRtl()).toBe(false)
  })

  it('is left to right for any other value and outside a page (the background worker)', () => {
    document.documentElement.dir = 'auto'
    expect(documentDirection()).toBe('ltr')
    expect(documentDirection(undefined as unknown as Document)).toBe('ltr')
  })
})

describe('inlineArrow', () => {
  it('maps ArrowRight to the line end and ArrowLeft to its start in a left-to-right UI', () => {
    expect(inlineArrow('ArrowRight', 'ltr')).toBe('end')
    expect(inlineArrow('ArrowLeft', 'ltr')).toBe('start')
  })

  it('flips them in a right-to-left UI', () => {
    expect(inlineArrow('ArrowLeft', 'rtl')).toBe('end')
    expect(inlineArrow('ArrowRight', 'rtl')).toBe('start')
  })

  it('defaults to the document direction', () => {
    expect(inlineArrow('ArrowLeft')).toBe('start')
    document.documentElement.dir = 'rtl'
    expect(inlineArrow('ArrowLeft')).toBe('end')
  })

  it('ignores every other key: Up and Down are never flipped', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'a']) {
      expect(inlineArrow(key, 'rtl')).toBeNull()
    }
  })
})
