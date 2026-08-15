import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ContactPage from '@/app/(marketing)/contact/page'

describe('ContactPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
  })

  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('combobox', { name: /subject/i }))
    await user.click(await screen.findByRole('option', { name: 'Billing question' }))
    await user.type(screen.getByLabelText(/message/i), 'Please help with my subscription.')
    await user.click(screen.getByRole('button', { name: /send message/i }))
  }

  it('POSTs JSON to /api/contact with the form fields', async () => {
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillAndSubmit(user)

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        subject: 'Billing question',
        message: 'Please help with my subscription.',
      }),
    })
    expect(await screen.findByText(/message sent/i)).toBeInTheDocument()
  })

  it('shows a specific message on 429 rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ ok: false }) })))
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillAndSubmit(user)

    expect(await screen.findByText(/too many messages sent/i)).toBeInTheDocument()
  })

  it('shows a generic error message on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) })))
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillAndSubmit(user)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('shows a generic error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network error') }))
    const user = userEvent.setup()
    render(<ContactPage />)
    await fillAndSubmit(user)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('reveals a free-text field and sends its value when "Other" is selected', async () => {
    const user = userEvent.setup()
    render(<ContactPage />)

    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('combobox', { name: /subject/i }))
    await user.click(await screen.findByRole('option', { name: 'Other' }))
    await user.type(screen.getByLabelText(/please specify/i), 'Partnership inquiry')
    await user.type(screen.getByLabelText(/message/i), 'Details about a partnership.')
    await user.click(screen.getByRole('button', { name: /send message/i }))

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        subject: 'Partnership inquiry',
        message: 'Details about a partnership.',
      }),
    })
  })
})
