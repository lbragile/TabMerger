import { describe, it, expect } from 'vitest'
import { isOpenableUrl, openableUrls } from '@/lib/safeOpen'

describe('isOpenableUrl', () => {
  it.each([
    'https://example.com/',
    'http://localhost:3000/a?b=c',
    'chrome://extensions/',
    'edge://settings/',
    'about:blank',
    'file:///C:/notes.txt',
    'chrome-extension://abcdefgh/popup.html',
    'moz-extension://abcdefgh/popup.html'
  ])('opens %j', (url) => {
    expect(isOpenableUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '   javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\r\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:image/png;base64,AAAA',
    'vbscript:msgbox(1)',
    'blob:https://example.com/0b1c'
  ])('does not open the script URL %j', (url) => {
    expect(isOpenableUrl(url)).toBe(false)
  })

  it.each([['an empty string', ''], ['undefined', undefined], ['null', null], ['a number', 5], ['an object', { url: 'https://a.com' }], ['an array', ['https://a.com']]])(
    'does not open %s',
    (_what, value) => {
      expect(isOpenableUrl(value)).toBe(false)
    }
  )
})

describe('openableUrls', () => {
  it('keeps the openable URLs in order', () => {
    expect(openableUrls(['https://a.com', 'javascript:alert(1)', 'chrome://newtab/', undefined, '', 'data:text/html,x', 'https://b.com'])).toEqual([
      'https://a.com',
      'chrome://newtab/',
      'https://b.com'
    ])
  })

  it('returns an empty list when nothing is openable, and for an empty list', () => {
    expect(openableUrls(['javascript:void(0)', null, ''])).toEqual([])
    expect(openableUrls([])).toEqual([])
  })
})
