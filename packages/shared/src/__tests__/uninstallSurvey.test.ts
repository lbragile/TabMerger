import { describe, it, expect } from 'vitest'
import {
  UNINSTALL_SURVEY_LIMITS,
  UNINSTALL_SURVEY_PARAMS,
  UNINSTALL_SURVEY_PATH,
  UNINSTALL_SURVEY_REASONS,
  buildUninstallSurveyUrl,
  isUninstallSurveyReasonId,
  parseUninstallSurveyParams,
} from '../constants/uninstallSurvey'

describe('UNINSTALL_SURVEY_REASONS', () => {
  it('has unique ids and labels, and the reasons limit covers every reason once', () => {
    const ids = UNINSTALL_SURVEY_REASONS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(UNINSTALL_SURVEY_REASONS.map((r) => r.label)).size).toBe(ids.length)
    expect(UNINSTALL_SURVEY_LIMITS.reasons).toBe(ids.length)
  })
})

describe('isUninstallSurveyReasonId', () => {
  it('accepts every listed id', () => {
    for (const { id } of UNINSTALL_SURVEY_REASONS) expect(isUninstallSurveyReasonId(id)).toBe(true)
  })

  it.each(['', 'made-up', 'BUG', 'toString', '__proto__', 1, null, undefined, {}])('rejects %j', (value) => {
    expect(isUninstallSurveyReasonId(value)).toBe(false)
  })
})

describe('parseUninstallSurveyParams', () => {
  it('keeps known values', () => {
    expect(parseUninstallSurveyParams({ version: '3.1.2', browser: 'firefox', channel: 'beta' })).toEqual({
      version: '3.1.2',
      browser: 'firefox',
      channel: 'beta',
    })
  })

  it.each(['3', '3.1', '3.1.2', '4.0.0.1', '99999.0'])('accepts the version %s', (version) => {
    expect(parseUninstallSurveyParams({ version }).version).toBe(version)
  })

  it.each(['', 'v3.1.2', '3.1.2-beta.1', '1.2.3.4.5', '123456', '3..1', '<script>', ' 3.1.2', 3.1])(
    'drops the version %j',
    (version) => {
      expect(parseUninstallSurveyParams({ version }).version).toBeUndefined()
    }
  )

  it('drops unknown browsers and channels, and non-strings', () => {
    expect(parseUninstallSurveyParams({ browser: 'safari', channel: 'nightly' })).toEqual({
      version: undefined,
      browser: undefined,
      channel: undefined,
    })
    expect(parseUninstallSurveyParams({ version: ['3.1.2'], browser: ['chrome'], channel: {} })).toEqual({
      version: undefined,
      browser: undefined,
      channel: undefined,
    })
  })
})

describe('buildUninstallSurveyUrl', () => {
  it('builds the survey URL with the known params', () => {
    const url = buildUninstallSurveyUrl('https://tabmerger.app', { version: '3.1.2', browser: 'chrome', channel: 'stable' })
    expect(url).toBe(
      `https://tabmerger.app${UNINSTALL_SURVEY_PATH}?${UNINSTALL_SURVEY_PARAMS.version}=3.1.2&${UNINSTALL_SURVEY_PARAMS.browser}=chrome&${UNINSTALL_SURVEY_PARAMS.channel}=stable`
    )
  })

  it('replaces any path on the web app address and leaves out unknown values', () => {
    expect(buildUninstallSurveyUrl('http://localhost:3000/some/path', { version: 'x', browser: 'opera' })).toBe(
      'http://localhost:3000/uninstalled'
    )
  })

  it.each([undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://example.com', 'chrome-extension://abc'])(
    'returns undefined for the web app address %j',
    (base) => {
      expect(buildUninstallSurveyUrl(base, { version: '3.1.2' })).toBeUndefined()
    }
  )

  it('stays under the 1023-character limit of runtime.setUninstallURL', () => {
    const url = buildUninstallSurveyUrl(`https://${'a'.repeat(200)}.example`, {
      version: '99999.99999.99999.99999',
      browser: 'firefox',
      channel: 'stable',
    })
    expect(url!.length).toBeLessThan(1023)
  })
})
