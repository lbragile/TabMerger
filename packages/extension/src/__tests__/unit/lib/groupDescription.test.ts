import { describe, it, expect } from 'vitest'
import { AI_MAX_GROUP_DESCRIPTION_LENGTH } from '@tabmerger/shared'
import { GROUP_NOTE_MAX_LENGTH, WINDOW_NOTE_MAX_LENGTH, appendDescription, canAppendDescription, cleanGroupDescription } from '@/lib/groupDescription'

describe('cleanGroupDescription (untrusted AI reply → plain note text)', () => {
  it('keeps ordinary text as is', () => {
    expect(cleanGroupDescription('Recipes for weeknight dinners.')).toBe('Recipes for weeknight dinners.')
  })

  it('collapses whitespace runs, including newlines, and trims', () => {
    expect(cleanGroupDescription('  One.\n\nTwo.\t Three.  ')).toBe('One. Two. Three.')
  })

  it('drops C0/C1 control characters and bidi embedding, override and isolate controls', () => {
    expect(cleanGroupDescription('a\u0000b\u001Fc\u007Fd\u0085e‪f‮g⁦h⁩i')).toBe('a b c d e f g h i')
  })

  it('keeps markup-looking text as text (it is rendered as text, never HTML)', () => {
    expect(cleanGroupDescription('<b>bold</b>')).toBe('<b>bold</b>')
  })

  it(`caps the result at ${AI_MAX_GROUP_DESCRIPTION_LENGTH} characters and trims the cut`, () => {
    const out = cleanGroupDescription(`${'a'.repeat(AI_MAX_GROUP_DESCRIPTION_LENGTH - 1)} tail`)
    expect(out).toBe('a'.repeat(AI_MAX_GROUP_DESCRIPTION_LENGTH - 1))
  })

  it.each([[''], ['   '], ['\u0007‮'], [42], [null], [undefined], [{ text: 'x' }]])('%j → null', (raw) => {
    expect(cleanGroupDescription(raw)).toBeNull()
  })
})

describe('appendDescription / canAppendDescription', () => {
  it('puts the description under the note after one blank line, dropping trailing whitespace of the note', () => {
    expect(appendDescription('Mine \n\n', 'AI text.')).toBe('Mine\n\nAI text.')
  })

  it(`fits while the result is at most ${GROUP_NOTE_MAX_LENGTH} characters`, () => {
    const note = 'n'.repeat(GROUP_NOTE_MAX_LENGTH - 2 - 10)
    expect(canAppendDescription(note, 'd'.repeat(10))).toBe(true)
    expect(canAppendDescription(note, 'd'.repeat(11))).toBe(false)
  })

  it('takes another limit (a window note) when given one', () => {
    expect(WINDOW_NOTE_MAX_LENGTH).toBe(500)
    expect(canAppendDescription('n'.repeat(20), 'd'.repeat(10), 31)).toBe(false)
    expect(canAppendDescription('n'.repeat(20), 'd'.repeat(10), 32)).toBe(true)
  })
})
