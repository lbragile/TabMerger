'use client'

import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Plain "Get more" CTA — starts a Stripe Checkout session at the default
 * quantity (50 calls, the server-side minimum) and redirects immediately.
 * Stripe's own Checkout page has adjustable_quantity enabled (50-500), so
 * the customer can change the amount there instead of us building and
 * maintaining our own quantity picker here.
 */
export function BuyCreditsButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout/credits', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? 'No checkout URL')
      }
      window.location.href = data.url
    } catch {
      toast.error('Could not start checkout')
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="text-primary hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      onClick={handleClick}
      disabled={loading}
    >
      {loading ? 'Loading...' : 'Get more'}
    </button>
  )
}
