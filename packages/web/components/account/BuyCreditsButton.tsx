'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function BuyCreditsButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout/credits', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={loading}>
      {loading ? 'Loading...' : 'Buy more AI calls'}
    </Button>
  )
}
