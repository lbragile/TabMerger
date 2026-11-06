/**
 * isPrivateHost: the destinations /api/og-preview refuses to connect to. Table-driven per range,
 * with the public neighbours of each range asserted allowed so the check does not over-block.
 */
import { describe, expect, it } from 'vitest'
import { isPrivateHost } from '@/lib/privateAddress'

describe('isPrivateHost: IPv4', () => {
  it.each([
    ['0.0.0.0/8', '0.0.0.0'],
    ['0.0.0.0/8', '0.255.255.255'],
    ['10/8', '10.0.0.1'],
    ['10/8', '10.255.255.255'],
    ['100.64/10', '100.64.0.1'],
    ['100.64/10', '100.127.255.254'],
    ['127/8', '127.0.0.1'],
    ['127/8', '127.255.255.254'],
    ['169.254/16 (cloud metadata)', '169.254.169.254'],
    ['172.16/12', '172.16.0.1'],
    ['172.16/12', '172.31.255.255'],
    ['192.0.0/24', '192.0.0.8'],
    ['192.168/16', '192.168.1.1'],
    ['198.18/15', '198.18.0.1'],
    ['198.18/15', '198.19.255.255'],
    ['224/4 multicast', '224.0.0.1'],
    ['224/4 multicast', '239.255.255.255'],
    ['240/4 reserved', '240.0.0.1'],
    ['240/4 broadcast', '255.255.255.255'],
  ])('blocks %s: %s', (_range, ip) => {
    expect(isPrivateHost(ip)).toBe(true)
  })

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '9.255.255.255',
    '11.0.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '126.255.255.255',
    '128.0.0.1',
    '169.253.0.1',
    '169.255.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '192.167.0.1',
    '192.169.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '93.184.216.34',
  ])('allows the public address %s', (ip) => {
    expect(isPrivateHost(ip)).toBe(false)
  })
})

describe('isPrivateHost: IPv6', () => {
  it.each([
    ['unspecified', '::'],
    ['loopback', '::1'],
    ['loopback, expanded', '0:0:0:0:0:0:0:1'],
    ['loopback, bracketed', '[::1]'],
    ['loopback, upper case', '[0000:0000:0000:0000:0000:0000:0000:0001]'],
    ['mapped loopback, dotted', '::ffff:127.0.0.1'],
    ['mapped loopback, hex', '::ffff:7f00:1'],
    ['mapped loopback, bracketed', '[::ffff:7f00:1]'],
    ['mapped loopback, expanded', '0:0:0:0:0:ffff:7f00:0001'],
    ['mapped metadata', '::ffff:169.254.169.254'],
    ['mapped metadata, hex', '::ffff:a9fe:a9fe'],
    ['mapped 10/8', '::ffff:10.1.2.3'],
    ['mapped 192.168/16', '::ffff:c0a8:101'],
    ['mapped 100.64/10', '::ffff:100.64.0.1'],
    ['IPv4-compatible loopback', '::127.0.0.1'],
    ['IPv4-compatible public-looking', '::8.8.8.8'],
    ['NAT64 loopback, hex', '64:ff9b::7f00:1'],
    ['NAT64 loopback, dotted', '64:ff9b::127.0.0.1'],
    ['NAT64 metadata', '64:ff9b::a9fe:a9fe'],
    ['NAT64 10/8', '64:ff9b::10.0.0.1'],
    ['local-use NAT64', '64:ff9b:1::1'],
    ['6to4 loopback', '2002:7f00:1::'],
    ['6to4 metadata', '2002:a9fe:a9fe::1'],
    ['6to4 192.168/16', '2002:c0a8:101::1'],
    ['link local fe80', 'fe80::1'],
    ['link local fe80, with zone', 'fe80::1%eth0'],
    ['link local fe90', 'fe90::1'],
    ['link local fea0', 'fea0::1'],
    ['link local febf', 'febf:ffff::1'],
    ['site local fec0', 'fec0::1'],
    ['unique local fc00', 'fc00::1'],
    ['unique local fd00', 'fd12:3456::1'],
    ['unique local fcff', 'fcff::1'],
    ['multicast ff02', 'ff02::1'],
    ['multicast ff00', 'ff00::'],
    ['discard 100::/64', '100::1'],
    ['documentation', '2001:db8::1'],
    ['Teredo', '2001::1'],
  ])('blocks %s: %s', (_label, ip) => {
    expect(isPrivateHost(ip)).toBe(true)
  })

  it.each([
    ['Google DNS', '2001:4860:4860::8888'],
    ['Cloudflare DNS', '2606:4700:4700::1111'],
    ['bracketed public', '[2606:4700:4700::1111]'],
    ['example.com', '2606:2800:220:1:248:1893:25c8:1946'],
    ['mapped public, dotted', '::ffff:8.8.8.8'],
    ['mapped public, hex', '::ffff:808:808'],
    ['NAT64 public', '64:ff9b::808:808'],
    ['6to4 public', '2002:808:808::1'],
    ['global unicast 2a00', '2a00::1'],
    ['just below fc00', 'fbff::1'],
    ['just above fdff', 'fe00::1'],
    ['2001 neighbour', '2001:1::1'],
    ['2001:db9', '2001:db9::1'],
    ['100:0:0:1::', '100:0:0:1::1'],
  ])('allows the public address %s: %s', (_label, ip) => {
    expect(isPrivateHost(ip)).toBe(false)
  })
})

describe('isPrivateHost: names', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'printer.local', 'db.internal', ''])(
    'blocks %j',
    (name) => {
      expect(isPrivateHost(name)).toBe(true)
    }
  )

  it.each(['example.com', 'www.example.com', 'localhost.example.com', 'notlocal.com', 'internal.example.com'])(
    'allows %s (its addresses are checked after resolution)',
    (name) => {
      expect(isPrivateHost(name)).toBe(false)
    }
  )
})
