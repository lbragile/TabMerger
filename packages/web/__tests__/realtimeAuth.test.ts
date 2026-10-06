import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { subscribeWithUserToken } from '@/lib/supabase/realtimeAuth'

type StatusCallback = (status: string, err?: Error) => void

/** A minimal stand-in for the browser Supabase client that records the order of calls. */
function fakeClient(session: unknown = { access_token: 'user-token' }) {
  const calls: string[] = []
  const channels: { topic: string; onStatus?: StatusCallback }[] = []
  let releaseRemoval: () => void = () => {}

  const client = {
    auth: {
      getSession: vi.fn(async () => {
        calls.push('getSession')
        return { data: { session } }
      }),
    },
    realtime: {
      setAuth: vi.fn(async (token?: string | null) => {
        calls.push(`setAuth:${token}`)
      }),
    },
    channel: vi.fn((topic: string) => {
      calls.push(`channel:${topic}`)
      const channel = {
        topic,
        onStatus: undefined as StatusCallback | undefined,
        subscribe(onStatus?: StatusCallback) {
          calls.push('subscribe')
          channel.onStatus = onStatus
          return channel
        },
      }
      channels.push(channel)
      return channel
    }),
    removeChannel: vi.fn(() => {
      calls.push('removeChannel')
      return new Promise<string>((resolve) => {
        releaseRemoval = () => {
          calls.push('removed')
          resolve('ok')
        }
      })
    }),
  }

  return {
    client: client as unknown as SupabaseClient,
    raw: client,
    calls,
    channels,
    releaseRemoval: () => releaseRemoval(),
  }
}

const configure = (channel: RealtimeChannel) => channel
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('subscribeWithUserToken', () => {
  it("sets the user's token on the realtime client before the channel is created and subscribed", async () => {
    const fake = fakeClient()
    subscribeWithUserToken(fake.client, 'topic-a', configure)
    await flush()

    expect(fake.calls).toEqual(['getSession', 'setAuth:user-token', 'channel:topic-a', 'subscribe'])
  })

  it('hands the new channel to configure and subscribes what it returns', async () => {
    const fake = fakeClient()
    const configured = vi.fn((channel: RealtimeChannel) => channel)
    subscribeWithUserToken(fake.client, 'topic-b', configured)
    await flush()

    expect(configured).toHaveBeenCalledTimes(1)
    expect(configured).toHaveBeenCalledWith(fake.channels[0])
  })

  it('creates and subscribes nothing when cleanup runs before the setup finished', async () => {
    const fake = fakeClient()
    const cleanup = subscribeWithUserToken(fake.client, 'topic-c', configure)
    cleanup()
    await flush()

    expect(fake.raw.channel).not.toHaveBeenCalled()
    expect(fake.raw.realtime.setAuth).not.toHaveBeenCalled()
    expect(fake.raw.removeChannel).not.toHaveBeenCalled()
  })

  it('removes the channel it created, once, on cleanup', async () => {
    const fake = fakeClient()
    const cleanup = subscribeWithUserToken(fake.client, 'topic-d', configure)
    await flush()

    cleanup()
    cleanup()

    expect(fake.raw.removeChannel).toHaveBeenCalledTimes(1)
    expect(fake.raw.removeChannel).toHaveBeenCalledWith(fake.channels[0])
  })

  it('waits for the previous channel on the same topic to be removed before joining again', async () => {
    // The realtime client hands back the SAME channel object for a topic that is still leaving,
    // and subscribing that one joins nothing.
    const fake = fakeClient()
    const cleanup = subscribeWithUserToken(fake.client, 'topic-e', configure)
    await flush()
    cleanup()

    subscribeWithUserToken(fake.client, 'topic-e', configure)
    await flush()
    expect(fake.raw.channel).toHaveBeenCalledTimes(1)

    fake.releaseRemoval()
    await flush()
    expect(fake.raw.channel).toHaveBeenCalledTimes(2)
    expect(fake.calls.indexOf('removed')).toBeLessThan(fake.calls.lastIndexOf('channel:topic-e'))
  })

  it('does not join anonymously when there is no session, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakeClient(null)
    subscribeWithUserToken(fake.client, 'topic-f', configure)
    await flush()

    expect(fake.raw.channel).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('logs once when the channel reports CHANNEL_ERROR, TIMED_OUT or CLOSED', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakeClient()
    subscribeWithUserToken(fake.client, 'topic-g', configure)
    await flush()

    fake.channels[0].onStatus!('SUBSCRIBED')
    expect(warn).not.toHaveBeenCalled()

    fake.channels[0].onStatus!('CHANNEL_ERROR', new Error('boom'))
    fake.channels[0].onStatus!('TIMED_OUT')
    fake.channels[0].onStatus!('CLOSED')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not log the CLOSED that its own cleanup causes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakeClient()
    const cleanup = subscribeWithUserToken(fake.client, 'topic-h', configure)
    await flush()

    cleanup()
    fake.channels[0].onStatus!('CLOSED')

    expect(warn).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when the session cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = fakeClient()
    fake.raw.auth.getSession.mockRejectedValueOnce(new Error('storage unavailable'))

    expect(() => subscribeWithUserToken(fake.client, 'topic-i', configure)).not.toThrow()
    await flush()

    expect(fake.raw.channel).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
