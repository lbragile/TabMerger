import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { PostHog } from 'posthog-js'
import { PostHogProvider, applyPostHogConsent, postHogConfig } from '@/components/posthog-provider'
import { openCookieSettings, resetConsentStateForTests, setConsentChoice } from '@/lib/consent'

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
})

describe('applyPostHogConsent', () => {
  it('starts cookieless, without recording, when no choice is stored', () => {
    localStorage.setItem('ph_old_posthog', '{}')
    document.cookie = 'ph_old_posthog=1; Path=/'
    applyPostHogConsent(instance, KEY, null)
    expect(fake.init).toHaveBeenCalledWith(KEY, expect.objectContaining({ persistence: 'memory', disable_session_recording: true }))
    expect(fake.register).toHaveBeenCalledWith({ environment: expect.any(String) })
    // Identifiers left from before consent existed are removed.
    expect(localStorage.getItem('ph_old_posthog')).toBeNull()
    expect(document.cookie).not.toContain('ph_old_posthog')
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

  it('follows each change of choice, and ignores the banner merely opening', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    render(<PostHogProvider />)
    await waitFor(() => expect(fake.init).toHaveBeenCalledWith(KEY, expect.objectContaining({ persistence: 'memory' })))

    act(() => setConsentChoice('granted'))
    expect(fake.startSessionRecording).toHaveBeenCalledTimes(1)

    act(() => openCookieSettings())
    expect(fake.set_config).toHaveBeenCalledTimes(1)

    act(() => setConsentChoice('denied'))
    expect(fake.opt_out_capturing).toHaveBeenCalledTimes(1)
    expect(fake.stopSessionRecording).toHaveBeenCalledTimes(1)
  })

  it('stops listening once unmounted', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY)
    const { unmount } = render(<PostHogProvider />)
    await waitFor(() => expect(fake.init).toHaveBeenCalled())
    unmount()
    act(() => setConsentChoice('denied'))
    expect(fake.opt_out_capturing).not.toHaveBeenCalled()
  })
})
