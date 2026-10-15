import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isAlarmDelayMinutes, isOwnExtensionPage, isReminderAlarmName } from '@/lib/messageSender'

type Sender = chrome.runtime.MessageSender
const setChrome = (origin: string, id = 'abc') => {
  ;(globalThis as { chrome?: unknown }).chrome = { runtime: { id, getURL: (p: string) => `${origin}${p}` } }
}
let saved: unknown
beforeEach(() => {
  saved = (globalThis as { chrome?: unknown }).chrome
  setChrome('chrome-extension://abc/')
})
afterEach(() => void ((globalThis as { chrome?: unknown }).chrome = saved))

describe('isOwnExtensionPage', () => {
  it('rejects a missing sender', () => {
    expect(isOwnExtensionPage(undefined)).toBe(false)
  })

  it('rejects another extension id', () => {
    expect(isOwnExtensionPage({ id: 'other', url: 'chrome-extension://abc/popup.html' } as Sender)).toBe(false)
  })

  it('rejects a sender with no url, with or without a tab', () => {
    expect(isOwnExtensionPage({ id: 'abc' } as Sender)).toBe(false)
    expect(isOwnExtensionPage({ id: 'abc', tab: { id: 1 } } as Sender)).toBe(false)
  })

  it('rejects a content script: own id but the web page url', () => {
    expect(isOwnExtensionPage({ id: 'abc', tab: { id: 1 }, url: 'https://evil.example/' } as Sender)).toBe(false)
    expect(isOwnExtensionPage({ id: 'abc', url: 'https://evil.example/' } as Sender)).toBe(false)
  })

  it('accepts a url under the own chrome-extension:// origin, with and without a tab', () => {
    expect(isOwnExtensionPage({ id: 'abc', url: 'chrome-extension://abc/popup.html' } as Sender)).toBe(true)
    expect(isOwnExtensionPage({ id: 'abc', tab: { id: 2 }, url: 'chrome-extension://abc/options.html#x' } as Sender)).toBe(true)
  })

  it('accepts a url under the own moz-extension:// origin, with and without a tab', () => {
    setChrome('moz-extension://1234-uuid/')
    expect(isOwnExtensionPage({ id: 'abc', url: 'moz-extension://1234-uuid/popup.html' } as Sender)).toBe(true)
    expect(isOwnExtensionPage({ id: 'abc', tab: { id: 2 }, url: 'moz-extension://1234-uuid/page.html' } as Sender)).toBe(true)
  })

  it('rejects a look-alike origin (longer id, other scheme, other uuid)', () => {
    expect(isOwnExtensionPage({ id: 'abc', url: 'chrome-extension://abc.evil/x.html' } as Sender)).toBe(false)
    expect(isOwnExtensionPage({ id: 'abc', url: 'chrome-extension://abcd/x.html' } as Sender)).toBe(false)
    expect(isOwnExtensionPage({ id: 'abc', url: 'moz-extension://abc/x.html' } as Sender)).toBe(false)
    setChrome('moz-extension://1234-uuid/')
    expect(isOwnExtensionPage({ id: 'abc', url: 'moz-extension://5678-uuid/x.html' } as Sender)).toBe(false)
  })

  it('rejects when chrome.runtime has no id, no getURL or an origin of an unexpected shape', () => {
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: {} }
    expect(isOwnExtensionPage({ id: undefined, url: 'chrome-extension://abc/x' } as Sender)).toBe(false)
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: { id: 'abc' } }
    expect(isOwnExtensionPage({ id: 'abc', url: 'chrome-extension://abc/x' } as Sender)).toBe(false)
    setChrome('https://')
    expect(isOwnExtensionPage({ id: 'abc', url: 'https://' } as Sender)).toBe(false)
    setChrome('')
    expect(isOwnExtensionPage({ id: 'abc', url: 'anything' } as Sender)).toBe(false)
  })

  it('rejects when chrome is not defined', () => {
    delete (globalThis as { chrome?: unknown }).chrome
    expect(isOwnExtensionPage({ id: 'abc', url: 'chrome-extension://abc/x' } as Sender)).toBe(false)
  })
})

describe('isReminderAlarmName', () => {
  it('allows reminder names only', () => {
    expect(isReminderAlarmName('reminder-1-2-3-4')).toBe(true)
    for (const n of ['tm-auto-backup', 'reminder-', 'reminder-a b', '', 5, null, `reminder-${'a'.repeat(121)}`]) expect(isReminderAlarmName(n)).toBe(false)
  })
})

describe('isAlarmDelayMinutes', () => {
  it('is a finite number above zero', () => {
    expect(isAlarmDelayMinutes(0.5)).toBe(true)
    for (const v of [0, -1, NaN, Infinity, '5', null, undefined]) expect(isAlarmDelayMinutes(v)).toBe(false)
  })
})
