/**
 * The consent-region split (lib/consentRegions.ts): which geo-IP countries and subdivisions ask
 * before analytics run, and how every malformed or unknown value falls to the safe side (opt-in).
 */
import { describe, expect, it } from 'vitest'
import {
  CONSENT_REGION_COOKIE,
  CONSENT_REGION_MAX_AGE_SECONDS,
  OPT_IN_COUNTRIES,
  consentRegionFor,
  parseConsentRegion,
  parseRegionOverride,
} from '@/lib/consentRegions'

const EU = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]

describe('consentRegionFor', () => {
  it('lists all 27 EU member states', () => {
    expect(EU).toHaveLength(27)
    for (const country of EU) expect(OPT_IN_COUNTRIES.has(country)).toBe(true)
  })

  it.each(EU)('asks first in EU member %s', (country) => {
    expect(consentRegionFor(country)).toBe('optin')
  })

  it.each(['NO', 'IS', 'LI'])('asks first in the rest of the EEA (%s)', (country) => {
    expect(consentRegionFor(country)).toBe('optin')
  })

  it.each(['GB', 'CH'])('asks first in %s', (country) => {
    expect(consentRegionFor(country)).toBe('optin')
  })

  it.each(['AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'GG', 'JE', 'IM', 'GI'])(
    'asks first in EU territory or a UK-style jurisdiction with its own code (%s)',
    (country) => {
      expect(consentRegionFor(country)).toBe('optin')
    }
  )

  it('asks first in Quebec but not in the rest of Canada', () => {
    expect(consentRegionFor('CA', 'QC')).toBe('optin')
    expect(consentRegionFor('CA', 'ON')).toBe('optout')
    expect(consentRegionFor('CA', 'BC')).toBe('optout')
    expect(consentRegionFor('CA')).toBe('optout')
    expect(consentRegionFor('CA', null)).toBe('optout')
  })

  it('only matches QC as a subdivision of Canada', () => {
    expect(consentRegionFor('US', 'QC')).toBe('optout')
  })

  it.each(['US', 'BR', 'JP', 'IN', 'AU', 'MX', 'CN'])('is on by default in %s', (country) => {
    expect(consentRegionFor(country)).toBe('optout')
  })

  it.each(['XX', 'ZZ', 'EU', 'AP'])('treats the "unknown" code %s as opt-in', (country) => {
    expect(consentRegionFor(country)).toBe('optin')
  })

  it.each([null, undefined, '', 'us', 'Us', 'USA', 'U', '1A', ' US', 'US ', 'U-S', '<script>'])(
    'treats a missing or malformed country %j as opt-in',
    (country) => {
      expect(consentRegionFor(country as string | null | undefined)).toBe('optin')
    }
  )

  it('ignores a malformed subdivision and lets the country decide', () => {
    expect(consentRegionFor('CA', 'qc')).toBe('optout')
    expect(consentRegionFor('CA', 'QC ')).toBe('optout')
    expect(consentRegionFor('CA', 'QUEB')).toBe('optout')
    expect(consentRegionFor('CA', '')).toBe('optout')
    expect(consentRegionFor('DE', 'garbage!')).toBe('optin')
  })
})

describe('parseConsentRegion', () => {
  it('accepts exactly the two regions', () => {
    expect(parseConsentRegion('optin')).toBe('optin')
    expect(parseConsentRegion('optout')).toBe('optout')
  })

  it.each([undefined, null, '', 'OPTOUT', 'optout ', 'opt-out', 'granted', 1, {}, ['optout']])(
    'reads %j as no region',
    (value) => {
      expect(parseConsentRegion(value)).toBeNull()
    }
  )
})

describe('parseRegionOverride', () => {
  it('splits a country, or a country and subdivision', () => {
    expect(parseRegionOverride('US')).toEqual({ country: 'US', region: null })
    expect(parseRegionOverride('DE')).toEqual({ country: 'DE', region: null })
    expect(parseRegionOverride('CA-QC')).toEqual({ country: 'CA', region: 'QC' })
  })

  it('tolerates surrounding whitespace (a hand-written env value)', () => {
    expect(parseRegionOverride('  CA-QC \n')).toEqual({ country: 'CA', region: 'QC' })
  })

  it.each([undefined, '', '   ', 'us', 'USA', 'CA-', 'CA-QUEB', 'CA_QC', 'US;DE', 'optout', '../US'])(
    'rejects %j',
    (value) => {
      expect(parseRegionOverride(value)).toBeNull()
    }
  )
})

describe('the region cookie', () => {
  it('is called tm_consent_region and lasts a day', () => {
    expect(CONSENT_REGION_COOKIE).toBe('tm_consent_region')
    expect(CONSENT_REGION_MAX_AGE_SECONDS).toBe(86_400)
  })
})
