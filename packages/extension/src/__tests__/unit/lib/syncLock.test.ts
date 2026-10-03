import { describe, it, expect, afterEach, vi } from 'vitest'
import { withSyncLock } from '@/lib/syncLock'

afterEach(() => {
  delete (globalThis.navigator as unknown as { locks?: unknown }).locks
})

describe('withSyncLock', () => {
  it('without Web Locks (jsdom): a second cycle started while one runs is skipped, not queued', async () => {
    let release!: () => void
    const first = withSyncLock(() => new Promise<string>((r) => { release = () => r('done') }))
    const second = await withSyncLock(async () => 'never')
    expect(second).toEqual({ ran: false })
    release()
    expect(await first).toEqual({ ran: true, value: 'done' })
    expect(await withSyncLock(async () => 'again')).toEqual({ ran: true, value: 'again' }) // free again
  })

  it('releases the exclusion when the cycle throws', async () => {
    await expect(withSyncLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await withSyncLock(async () => 1)).toEqual({ ran: true, value: 1 })
  })

  it('with Web Locks: requests tabmerger-sync with ifAvailable and skips when the lock is not granted', async () => {
    const request = vi.fn(async (_name: string, _opts: unknown, cb: (lock: unknown) => Promise<unknown>) => cb(null))
    Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true })
    expect(await withSyncLock(async () => 'x')).toEqual({ ran: false })
    expect(request).toHaveBeenCalledWith('tabmerger-sync', { ifAvailable: true }, expect.any(Function))
    request.mockImplementation(async (_n: string, _o: unknown, cb: (lock: unknown) => Promise<unknown>) => cb({}))
    expect(await withSyncLock(async () => 'x')).toEqual({ ran: true, value: 'x' })
  })
})
