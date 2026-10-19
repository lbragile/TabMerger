import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { PostHog } from 'posthog-js'
import { PostHogProvider, applyPostHogConsent, postHogConfig } from '@/components/posthog-provider'
import { openCookieSettings, resetConsentStateForTests, setConsentChoice } from '@/lib/consent'
import { REPLAY_BLOCK_SELECTOR, scrubPostHogEvent } from '@/lib/analyticsPrivacy'

const fake = vi.hoisted(() => {
  const posthog = {
    __loaded: false,
    init: vi.fn(() => {
      posthog.__loaded = true
    }),
    register: vi.fn(),
    set_config: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
  }
  return posthog
})
vi.mock('posthog-js', () => ({ default: fake }))

const KEY = 'phc_test_key'
const instance = fake as unknown as PostHog

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
  }
}

beforeEach(() => {
  fake.__loaded = false
  fake.has_opted_out_capturing.mockReturnValue(false)
  vi.clearAllMocks()
})

afterEach(() => {
  clearCookies()
  resetConsentStateForTests()
  vi.unstubAllEnvs()
  delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl
})

/** Lets the on-demand `import('posthog-js')` settle. */
const settle = () =>
  act(async () => {
    await import('posthog-js')
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('postHogConfig', () => {
  it('keeps identifiers in memory and records nothing without consent', () => {
    for (const choice of [null, 'denied'] as const) {
      expect(postHogConfig(choice)).toMatchObject({
        persistence: 'memory',
        disable_session_recording: true,
        session_recording: { maskAllInputs: true },
      })
    }
  })

  it('persists identifiers and records sessions (inputs masked) after Accept', () => {
    expect(postHogConfig('granted')).toMatchObject({
      persistence: 'localStorage+cookie',
      disable_session_recording: false,
      session_recording: { maskAllInputs: true },
      disable_surveys: true,
    })
  })

  it.each([null, 'denied', 'granted'] as const)(
    'keeps private data out whatever the choice (%s): no URL fragments, popups blocked from replay, events scrubbed',
    (choice) => {
      expect(postHogConfig(choice)).toMatchObject({
        disable_capture_url_hashes: true,
        before_send: scrubPostHogEvent,
        session_recording: { maskAllInputs: true, blockSelector: REPLAY_BLOCK_SELECTOR },
      })
    }
  )
})

describe('applyPostHogConsent', () => {
  it('does not start PostHog at all before a choice (opt-in region), and removes old identifiers', () => {
    localStorage.setItem('ph_old_posthog', '{}')
    document.cookie = 'ph_old_posthog=1; Path=/'
    applyPostHogConsent(instance, KEY, null)
    expect(fake.init).not.toHaveBeenCalled()
    // Identifiers left from before consent existed are removed.
    expect(localStorage.getItem('ph_old_posthog')).toBeNull()
    expect(document.cookie).not.toContain('ph_old_posthog')
  })

  it('tags every event with the deployment environment once started', () => {
    applyPostHogConsent(instance, KEY, 'granted')
    expect(fake.register).toHaveBeenCalledWith({ environment: expect.any(String) })
  })

  it('does not start PostHog at all after a stored Reject', () => {
    applyPostHogConsent(instance, KEY, 'denied')
    expect(fake.init).not.toHaveBeenCalled()
  })

  it('starts with persistence and recording after a stored Accept, undoing an earlier opt-out', () => {
    fake.has_opted_out_capturing.mockReturnValue(true)
    applyPostHogConsent(instance, KEY, 'granted')
    expect(fake.init).toHaveBeenCalledWith(KEY, expect.objectContaining({ persistence: 'localStorage+cookie', disable_session_recording: false }))
    expect(fake.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
  })

  it('switches a running instance to persistence and recording on Accept', () => {
    fake.__loaded = true
    fake.has_opted_out_capturing.mockReturnValue(true)
    applyPostHogConsent(instance, KEY, 'granted')
    expect(fake.set_config).toHaveBeenCalledWith({ persistence: 'localStorage+cookie', disable_persistence: false })
    expect(fake.opt_in_capturing).toHaveBeenCalled()
    expect(fake.startSessionRecording).toHaveBeenCalled()
    expect(fake.init).not.toHaveBeenCalled()
  })

  it('stops a running instance capturing, recording and storing on Reject', () => {
    fake.__loaded = true
    sessionStorage.setItem(`ph_${KEY}_posthog`, '{}')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    sessionStorage.setItem(`ph_${KEY}_primary_window_exists`, 'true')
    localStorage.setItem(`__ph_opt_in_out_${KEY}`, '0')
    applyPostHogConsent(instance, KEY, 'denied')
    expect(Object.keys(sessionStorage)).toEqual([])
    // PostHog's own record of the Reject stays, or a running instance would capture again.
    expect(localStorage.getItem(`__ph_opt_in_out_${KEY}`)).toBe('0')
    expect(fake.stopSessionRecording).toHaveBeenCalled()
    expect(fake.opt_out_capturing).toHaveBeenCalled()
    expect(fake.set_config).toHaveBeenCalledWith({ persistence: 'memory', disable_persistence: true })
    expect(fake.startSessionRecording).not.toHaveBeenCalled()
  })

  it('drops a running instance back to memory-only, without opting out, if the choice disappears', () => {
    fake.__loaded = true
    applyPostHogConsent(instance, KEY, null)
    expect(fake.stopSessionRecording).toHaveBeenCalled()
    expect(fake.opt_out_capturing).not.toHaveBeenCalled()
    expect(fake.set_config).toHaveBeenCalledWith({ persistence: 'memory', disable_persistence: true })
  })
})

describe('PostHogProvider', () => {
  it('does nothing without a project key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    render(<PostHogProvider />)
    await act(async () => {})
    expect(fake.init).not.toHaveBeenCalled()
  })

  it('starts nothing before a choice in an opt-in region, then follows Accept and Reject', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    render(<PostHogProvider />)
    await settle()
    expect(fake.init).not.toHaveBeenCalled()

    act(() => setConsentChoice('granted'))
    expect(fake.init).toHaveBeenCalledWith(KEY, expect.objectContaining({ persistence: 'localStorage+cookie', disable_session_recording: false }))

    act(() => openCookieSettings())
    expect(fake.set_config).not.toHaveBeenCalled()

    act(() => setConsentChoice('denied'))
    expect(fake.opt_out_capturing).toHaveBeenCalledTimes(1)
    expect(fake.stopSessionRecording).toHaveBeenCalledTimes(1)
  })

  it('starts with recording straight away in an opt-out region, and a Reject there stops and clears it', async () => {
    document.cookie = 'tm_consent_region=optout; Path=/'
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    render(<PostHogProvider />)
    await waitFor(() =>
      expect(fake.init).toHaveBeenCalledWith(KEY, expect.objectContaining({ persistence: 'localStorage+cookie', disable_session_recording: false }))
    )
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')

    act(() => setConsentChoice('denied'))
    expect(fake.stopSessionRecording).toHaveBeenCalledTimes(1)
    expect(fake.opt_out_capturing).toHaveBeenCalledTimes(1)
    expect(fake.set_config).toHaveBeenCalledWith({ persistence: 'memory', disable_persistence: true })
    expect(sessionStorage.getItem(`ph_${KEY}_window_id`)).toBeNull()
  })

  it.each(['optin', 'optout'])('never starts under Global Privacy Control (%s region) until an explicit Accept', async (region) => {
    document.cookie = `tm_consent_region=${region}; Path=/`
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    render(<PostHogProvider />)
    await settle()
    expect(fake.init).not.toHaveBeenCalled()
    act(() => setConsentChoice('granted'))
    expect(fake.init).toHaveBeenCalled()
  })

  it('stops listening once unmounted', async () => {
    document.cookie = 'tm_consent_region=optout; Path=/'
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    const { unmount } = render(<PostHogProvider />)
    await waitFor(() => expect(fake.init).toHaveBeenCalled())
    unmount()
    act(() => setConsentChoice('denied'))
    expect(fake.opt_out_capturing).not.toHaveBeenCalled()
  })
})
