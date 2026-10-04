import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/**
 * The one way to open a Realtime channel in the web app.
 *
 * Rule: a channel is subscribed only after the realtime client holds the user's access token.
 * `channel.subscribe()` copies the realtime client's current token into the join message at the
 * moment it is called. A browser client that was just created has not read its session from the
 * cookies yet, so a channel subscribed in the same tick joins as an anonymous user: the server
 * accepts the join, and row level security then filters out every `postgres_changes` event.
 *
 * So this helper, in order: reads the session, puts its token on the realtime client
 * (`realtime.setAuth(token)`), and only then creates and subscribes the channel.
 *
 * Token refresh on a long-lived page needs nothing extra: supabase-js listens to its own auth
 * events and calls `realtime.setAuth(newToken)` on TOKEN_REFRESHED, which sends the new token to
 * every joined channel. That holds as long as the channel lives on the shared browser client
 * (`createClient()` from `lib/supabase/client.ts` returns one instance per page).
 *
 * The setup is asynchronous, so the returned cleanup works at any point: called before the setup
 * finished, nothing is ever created or subscribed (this is what keeps the development double
 * mount of an effect down to one channel); called after, it removes the channel it created.
 *
 * @param configure Adds the listeners (`.on(...)`) and returns the channel. Do not call
 *   `.subscribe()` in it.
 * @returns Cleanup function, safe to call more than once.
 */
export function subscribeWithUserToken(
  supabase: SupabaseClient,
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel
): () => void {
  let cancelled = false
  let warned = false
  let channel: RealtimeChannel | null = null

  const warnOnce = (reason: string, detail?: unknown) => {
    if (warned || cancelled) return
    warned = true
    console.warn(`[realtime] Live updates are off for "${topic}": ${reason}`, detail ?? '')
  }

  void (async () => {
    try {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const token = data.session?.access_token
      if (!token) {
        warnOnce('no signed-in session in this browser.')
        return
      }
      await supabase.realtime.setAuth(token)

      // The realtime client returns the existing channel object for a topic that is still being
      // removed, and subscribing that one joins nothing. Let the earlier removal finish first.
      await pendingRemovals.get(removalKey(supabase, topic))
      if (cancelled) return

      channel = configure(supabase.channel(topic))
      channel.subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          warnOnce(`the channel reported ${status}.`, err)
        }
      })
    } catch (err) {
      warnOnce('the channel could not be set up.', err)
    }
  })()

  return () => {
    cancelled = true
    const created = channel
    channel = null
    if (!created) return

    const key = removalKey(supabase, topic)
    let result: unknown
    try {
      result = supabase.removeChannel(created)
    } catch {
      // Nothing to wait for: the channel is gone either way.
    }
    const removal: Promise<unknown> = Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        if (pendingRemovals.get(key) === removal) pendingRemovals.delete(key)
      })
    pendingRemovals.set(key, removal)
  }
}

/** Removals still in flight, per client and topic. */
const pendingRemovals = new Map<string, Promise<unknown>>()
const clientIds = new WeakMap<object, number>()
let nextClientId = 1

function removalKey(supabase: SupabaseClient, topic: string): string {
  let id = clientIds.get(supabase)
  if (!id) {
    id = nextClientId++
    clientIds.set(supabase, id)
  }
  return `${id}:${topic}`
}
