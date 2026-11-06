import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEPLOY_PLATFORMS,
  EDGE_PROVIDERS,
  OFF_PLATFORM_GEO_ORDER,
  deployPlatform,
  isDeployPlatform,
} from '@/lib/deployment'
import { trustedClientAddress } from '@/lib/clientIp'
import { geoFromHeaders } from '@/lib/consentRegions'

/**
 * The one registry of per-host request headers (`EDGE_PROVIDERS` in lib/deployment.ts) and the two
 * readers built on it: the client address for rate limits and the geo pair for the consent region.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('EDGE_PROVIDERS', () => {
  it('lists every platform, each with at least one client-address header and a geo pair', () => {
    expect([...DEPLOY_PLATFORMS].sort()).toEqual(['cloudflare', 'vercel'])
    for (const platform of DEPLOY_PLATFORMS) {
      const provider = EDGE_PROVIDERS[platform]
      expect(provider.clientIp.length).toBeGreaterThan(0)
      expect(provider.country).toMatch(/^[a-z-]+$/)
      expect(provider.region).toMatch(/^[a-z-]+$/)
    }
  })

  it('keeps the documented header names', () => {
    expect(EDGE_PROVIDERS.cloudflare).toEqual({
      clientIp: ['cf-connecting-ip'],
      country: 'cf-ipcountry',
      region: 'cf-region-code',
    })
    expect(EDGE_PROVIDERS.vercel).toEqual({
      clientIp: ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'],
      country: 'x-vercel-ip-country',
      region: 'x-vercel-ip-country-region',
    })
  })

  it('tries Vercel geo headers before Cloudflare off-platform, covering every platform', () => {
    expect(OFF_PLATFORM_GEO_ORDER).toEqual(['vercel', 'cloudflare'])
    expect([...OFF_PLATFORM_GEO_ORDER].sort()).toEqual([...DEPLOY_PLATFORMS].sort())
  })

  it('isDeployPlatform accepts only registry keys, never inherited object properties', () => {
    expect(isDeployPlatform('vercel')).toBe(true)
    expect(isDeployPlatform('cloudflare')).toBe(true)
    expect(isDeployPlatform('netlify')).toBe(false)
    expect(isDeployPlatform('toString')).toBe(false)
    expect(isDeployPlatform('')).toBe(false)
    expect(isDeployPlatform(undefined)).toBe(false)
  })

  it('deployPlatform ignores a DEPLOY_PLATFORM that is not a registry key', () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('DEPLOY_PLATFORM', 'constructor')
    expect(deployPlatform()).toBeNull()
    vi.stubEnv('DEPLOY_PLATFORM', 'cloudflare')
    expect(deployPlatform()).toBe('cloudflare')
  })
})

describe('trustedClientAddress', () => {
  const all = new Headers({
    'cf-connecting-ip': '198.51.100.1',
    'x-vercel-forwarded-for': '198.51.100.2',
    'x-real-ip': '198.51.100.3',
    'x-forwarded-for': '198.51.100.4, 10.0.0.1',
  })

  it('reads only cf-connecting-ip on Cloudflare', () => {
    expect(trustedClientAddress(all, 'cloudflare')).toBe('198.51.100.1')
    const noCf = new Headers({ 'x-forwarded-for': '198.51.100.4', 'x-real-ip': '198.51.100.3' })
    expect(trustedClientAddress(noCf, 'cloudflare')).toBeNull()
  })

  it('reads Vercel headers in order and never cf-connecting-ip', () => {
    expect(trustedClientAddress(all, 'vercel')).toBe('198.51.100.2')
    expect(trustedClientAddress(new Headers({ 'x-real-ip': '198.51.100.3', 'x-forwarded-for': '198.51.100.4' }), 'vercel')).toBe(
      '198.51.100.3'
    )
    expect(trustedClientAddress(new Headers({ 'x-forwarded-for': ' 198.51.100.4 , 10.0.0.1' }), 'vercel')).toBe('198.51.100.4')
    expect(trustedClientAddress(new Headers({ 'cf-connecting-ip': '198.51.100.1' }), 'vercel')).toBeNull()
  })

  it('stops at the first header present even when it is empty (no fall-through past it)', () => {
    const headers = new Headers({ 'x-vercel-forwarded-for': '', 'x-real-ip': '198.51.100.3' })
    expect(trustedClientAddress(headers, 'vercel')).toBeNull()
  })

  it('is null off-platform whatever the client sent', () => {
    expect(trustedClientAddress(all, null)).toBeNull()
  })

  it('defaults the platform from the environment', () => {
    vi.stubEnv('DEPLOY_PLATFORM', 'cloudflare')
    expect(trustedClientAddress(all)).toBe('198.51.100.1')
  })
})

describe('geoFromHeaders', () => {
  const both = new Headers({
    'x-vercel-ip-country': 'CA',
    'x-vercel-ip-country-region': 'QC',
    'cf-ipcountry': 'DE',
    'cf-region-code': 'BE',
  })

  it('reads only the current platform pair', () => {
    expect(geoFromHeaders(both, 'vercel')).toEqual({ country: 'CA', region: 'QC' })
    expect(geoFromHeaders(both, 'cloudflare')).toEqual({ country: 'DE', region: 'BE' })
  })

  it('off-platform prefers the Vercel pair, then Cloudflare, never mixing the two', () => {
    expect(geoFromHeaders(both, null)).toEqual({ country: 'CA', region: 'QC' })
    const cfWithStrayVercelRegion = new Headers({
      'x-vercel-ip-country-region': 'QC',
      'cf-ipcountry': 'DE',
    })
    expect(geoFromHeaders(cfWithStrayVercelRegion, null)).toEqual({ country: 'DE', region: null })
  })

  it('off-platform with no country anywhere returns the last pair read', () => {
    expect(geoFromHeaders(new Headers({ 'cf-region-code': 'QC' }), null)).toEqual({ country: null, region: 'QC' })
    expect(geoFromHeaders(new Headers(), null)).toEqual({ country: null, region: null })
  })

  it('strips a full ISO 3166-2 prefix for the same country only', () => {
    expect(geoFromHeaders(new Headers({ 'cf-ipcountry': 'CA', 'cf-region-code': 'CA-QC' }), 'cloudflare')).toEqual({
      country: 'CA',
      region: 'QC',
    })
    expect(geoFromHeaders(new Headers({ 'cf-ipcountry': 'CA', 'cf-region-code': 'US-QC' }), 'cloudflare')).toEqual({
      country: 'CA',
      region: 'US-QC',
    })
  })

  it('passes Cloudflare XX / T1 through as countries for consentRegionFor to treat as unknown', () => {
    expect(geoFromHeaders(new Headers({ 'cf-ipcountry': 'XX' }), 'cloudflare').country).toBe('XX')
    expect(geoFromHeaders(new Headers({ 'cf-ipcountry': 'T1' }), 'cloudflare').country).toBe('T1')
  })
})
