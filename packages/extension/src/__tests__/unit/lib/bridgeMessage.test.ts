import { describe, it, expect } from 'vitest'
import { EXTENSION_MESSAGE } from '@tabmerger/shared'
import { parseBridgeMessage, MAX_BRIDGE_TOKEN_LENGTH } from '@/lib/bridgeMessage'

describe('parseBridgeMessage', () => {
  it.each([EXTENSION_MESSAGE.PING, EXTENSION_MESSAGE.SYNC_NOW, EXTENSION_MESSAGE.SYNC_AUTH])('accepts the website message type %s', (type) => {
    expect(parseBridgeMessage({ type })).toEqual({ type })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'PING'],
    ['a number', 1],
    ['an array', [{ type: 'PING' }]],
    ['an object without type', { accessToken: 'a' }],
    ['a non-string type', { type: 1 }],
    ['an object type', { type: { toString: () => 'PING' } }],
    ['an unknown type', { type: 'OTHER' }],
    ['a type the extension sends, not the website', { type: EXTENSION_MESSAGE.PONG }],
    ['a different letter case', { type: 'ping' }]
  ])('rejects %s', (_what, msg) => {
    expect(parseBridgeMessage(msg)).toBeNull()
  })

  it('keeps string tokens and copies nothing else', () => {
    expect(parseBridgeMessage({ type: 'SYNC_AUTH', accessToken: 'a', refreshToken: 'b', extra: 'x', windowId: 3 })).toEqual({
      type: 'SYNC_AUTH',
      accessToken: 'a',
      refreshToken: 'b'
    })
  })

  it.each([['a number', 5], ['an object', { token: 'a' }], ['an array', ['a']], ['an empty string', ''], ['null', null]])('drops a token that is %s', (_what, token) => {
    expect(parseBridgeMessage({ type: 'SYNC_AUTH', accessToken: token, refreshToken: token })).toEqual({ type: 'SYNC_AUTH' })
  })

  it('accepts a token at the length limit and drops one beyond it', () => {
    const atLimit = 'a'.repeat(MAX_BRIDGE_TOKEN_LENGTH)
    expect(parseBridgeMessage({ type: 'SYNC_AUTH', accessToken: atLimit, refreshToken: 'r' })).toEqual({ type: 'SYNC_AUTH', accessToken: atLimit, refreshToken: 'r' })
    expect(parseBridgeMessage({ type: 'SYNC_AUTH', accessToken: atLimit + 'a', refreshToken: 'r' })).toEqual({ type: 'SYNC_AUTH', refreshToken: 'r' })
  })
})
