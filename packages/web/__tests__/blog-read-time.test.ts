/**
 * Read time across scripts: spaced text (English, Korean) counts words; Chinese and Japanese count
 * characters at their own reading rate, so a translation reads in about the English time.
 */
import { describe, expect, it } from 'vitest'
import { CJK_CHARS_PER_MINUTE, WORDS_PER_MINUTE, countReadableWords } from '@/scripts/generate-blog-index.mjs'
import { READ_WORDS_PER_MINUTE, readMinutes } from '@/lib/blog/readTime'

const repeat = (text: string, times: number) => Array.from({ length: times }, () => text).join(' ')

describe('countReadableWords', () => {
  it('uses the same words-per-minute rate as the page', () => {
    expect(WORDS_PER_MINUTE).toBe(READ_WORDS_PER_MINUTE)
    expect(CJK_CHARS_PER_MINUTE).toBe(500)
  })

  it('counts English and Korean by words, as before', () => {
    expect(countReadableWords('Save every open tab with one shortcut.')).toBe(7)
    expect(countReadableWords('열린 탭을 모두 저장하는 방법')).toBe(5)
  })

  it('counts Japanese and Chinese characters at 500 a minute', () => {
    // 1000 CJK characters ≈ 2 minutes, like 460 English words.
    expect(countReadableWords('開'.repeat(1000))).toBe(460)
    expect(countReadableWords('ひらがなとカタカナ'.repeat(100))).toBe(Math.round((900 * 230) / 500))
  })

  it('gives a Japanese or Chinese text about the read time of its English equivalent', () => {
    const english = repeat('Save every open tab in your browser with one shortcut and get it back later.', 60) // 900 words
    const japanese = 'ブラウザで開いているすべてのタブをショートカットひとつで保存して、あとで元に戻せます。'.repeat(48) // ~2000 chars
    const chinese = '用一个快捷键保存浏览器中所有打开的标签页，以后再把它们找回来。'.repeat(64) // ~2000 chars
    const en = readMinutes(countReadableWords(english))
    for (const text of [japanese, chinese]) {
      expect(Math.abs(readMinutes(countReadableWords(text)) - en)).toBeLessThanOrEqual(1)
    }
  })

  it('still ignores JSX props and the post block', () => {
    expect(countReadableWords("export const post = {\n  title: '一二三',\n}\n\n<Kbd>Ctrl</Kbd> 保存")).toBe(1 + Math.round((2 * 230) / 500))
  })
})
