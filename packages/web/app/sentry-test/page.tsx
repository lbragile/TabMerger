'use client'

import { notFound } from 'next/navigation'

// ponytail: temporary verification page for the Sentry setup — delete this file once confirmed.

export default function SentryTestPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

  return (
    <div style={{ padding: 40, maxWidth: 480, fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Sentry verification page</h1>
      <p
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          fontFamily: 'monospace',
          background: dsn ? '#e6f7ec' : '#fdecea',
          color: dsn ? '#1a7f37' : '#b3261e',
        }}
      >
        NEXT_PUBLIC_SENTRY_DSN: {dsn ? `set (${dsn.slice(0, 30)}...)` : 'NOT SET — this is why nothing reaches Sentry'}
      </p>
      <p style={{ color: '#555', marginBottom: 20, lineHeight: 1.5 }}>
        Clicking the button below throws a real error from rendered page code (not the
        DevTools console, which Sentry doesn't reliably catch). Check your Sentry
        project&apos;s Issues tab a few seconds after clicking — if it doesn&apos;t show
        up, check the Network tab for a request to <code>/sentry-tunnel</code>.
      </p>
      <button
        onClick={() => {
          throw new Error('Sentry test error — delete /sentry-test when done verifying')
        }}
        style={{
          background: '#e2434b',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          padding: '10px 18px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Throw test error
      </button>
    </div>
  )
}
