import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from '@/components/ui/password-input'

describe('PasswordInput', () => {
  it('renders type="password" by default', () => {
    render(<PasswordInput placeholder="Passphrase" />)
    expect(screen.getByPlaceholderText('Passphrase')).toHaveAttribute('type', 'password')
  })

  it('toggles to type="text" when the eye icon is clicked, and back on second click', async () => {
    const user = userEvent.setup()
    render(<PasswordInput placeholder="Passphrase" />)
    const input = screen.getByPlaceholderText('Passphrase')
    const toggle = screen.getByRole('button', { name: 'Show passphrase' })

    await user.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide passphrase' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide passphrase' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})
