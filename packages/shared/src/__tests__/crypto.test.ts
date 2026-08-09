import { describe, expect, it } from 'vitest'
import {
  KDF_ITERATIONS,
  decryptBlob,
  deriveWrappingKey,
  encryptBlob,
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
} from '../crypto/index'

// Shape mirrors packages/shared's Group/Tab types closely enough to exercise
// nested arrays/objects without importing them (keeps this test standalone).
const sampleGroup = {
  id: 'g1',
  name: 'Research',
  color: 'rgba(255,0,0,1)',
  updatedAt: 1700000000000,
  note: 'do not lose this',
  windows: [
    {
      tabs: [
        { id: 0, title: 'Example', url: 'https://example.com', favIconUrl: 'https://x/f.ico' },
        { id: 0, title: 'Second', url: 'https://example.org', note: 'important' },
      ],
    },
  ],
}

describe('crypto primitives', () => {
  it('round-trips encryptBlob/decryptBlob preserving the original object exactly', async () => {
    const key = await generateDataKey()
    const encrypted = await encryptBlob(key, sampleGroup)
    const decrypted = await decryptBlob<typeof sampleGroup>(key, encrypted)
    expect(decrypted).toEqual(sampleGroup)
  })

  it('throws when decrypting with the wrong key', async () => {
    const key = await generateDataKey()
    const wrongKey = await generateDataKey()
    const encrypted = await encryptBlob(key, sampleGroup)
    await expect(decryptBlob(wrongKey, encrypted)).rejects.toThrow()
  })

  it('throws when the ciphertext is tampered with (GCM auth tag catches it)', async () => {
    const key = await generateDataKey()
    const encrypted = await encryptBlob(key, sampleGroup)

    const ctBytes = Uint8Array.from(atob(encrypted.ct), (c) => c.charCodeAt(0))
    ctBytes[0] ^= 0xff // flip a byte
    const tampered = { ...encrypted, ct: btoa(String.fromCharCode(...ctBytes)) }

    await expect(decryptBlob(key, tampered)).rejects.toThrow()
  })

  it('wraps and unwraps a data key, and the unwrapped key still decrypts prior data', async () => {
    const dataKey = await generateDataKey()
    const encrypted = await encryptBlob(dataKey, sampleGroup)

    const salt = crypto.getRandomValues(new Uint8Array(16))
    const wrappingKey = await deriveWrappingKey('correct horse battery staple', salt, KDF_ITERATIONS)
    const { wrappedKey, iv } = await wrapDataKey(dataKey, wrappingKey)

    const unwrappedKey = await unwrapDataKey(wrappedKey, iv, wrappingKey)
    const decrypted = await decryptBlob<typeof sampleGroup>(unwrappedKey, encrypted)
    expect(decrypted).toEqual(sampleGroup)
  })

  it('produces different ciphertext for the same plaintext and key across calls (random IV)', async () => {
    const key = await generateDataKey()
    const first = await encryptBlob(key, sampleGroup)
    const second = await encryptBlob(key, sampleGroup)

    expect(first.iv).not.toEqual(second.iv)
    expect(first.ct).not.toEqual(second.ct)
  })
})
