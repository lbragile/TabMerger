import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('shows a pointer cursor on hover', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toHaveClass('cursor-pointer')
  })

  it('shows a not-allowed cursor when disabled, and does not show pointer', () => {
    render(<Button disabled>Click me</Button>)
    const btn = screen.getByRole('button', { name: 'Click me' })
    expect(btn).toHaveClass('disabled:cursor-not-allowed')
    expect(btn).toBeDisabled()
  })
})
