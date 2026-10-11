import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { SignOutForm } from '@/components/auth/SignOutForm'
import { AccountMenu } from '@/components/layout/AccountMenu'

describe('SignOutForm', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('posts to the sign-out route and clears the cached data keys when submitted', () => {
    sessionStorage.setItem('tabmerger:dataKey:user-1', 'x')
    sessionStorage.setItem('unrelated', 'keep')
    const { container } = render(
      <SignOutForm>
        <button type="submit">Sign out</button>
      </SignOutForm>,
    )
    const form = container.querySelector('form') as HTMLFormElement
    expect(form).toHaveAttribute('action', '/api/auth/sign-out')
    expect(form.method).toBe('post')

    fireEvent.submit(form)
    expect(sessionStorage.getItem('tabmerger:dataKey:user-1')).toBeNull()
    expect(sessionStorage.getItem('unrelated')).toBe('keep')
  })

  it('passes other props through, so Radix can make it a menu item', () => {
    const ref = createRef<HTMLFormElement>()
    const onPointerMove = vi.fn()
    render(
      <SignOutForm ref={ref} role="menuitem" tabIndex={-1} data-testid="form" onPointerMove={onPointerMove}>
        <button type="submit">Sign out</button>
      </SignOutForm>,
    )
    const form = screen.getByTestId('form')
    expect(form).toHaveAttribute('role', 'menuitem')
    expect(form).toHaveAttribute('tabindex', '-1')
    expect(ref.current).toBe(form)
    fireEvent.pointerMove(form)
    expect(onPointerMove).toHaveBeenCalled()
  })

  it('still clears the keys when the caller supplies its own onSubmit, and calls it too', () => {
    sessionStorage.setItem('tabmerger:dataKey:user-1', 'x')
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    render(
      <SignOutForm onSubmit={onSubmit} data-testid="form">
        <button type="submit">Sign out</button>
      </SignOutForm>,
    )
    fireEvent.submit(screen.getByTestId('form'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('tabmerger:dataKey:user-1')).toBeNull()
  })

  it('cannot be pointed at another action or method by its caller', () => {
    // @ts-expect-error — the props are omitted from the type on purpose
    render(<SignOutForm action="/elsewhere" method="get" data-testid="form" />)
    const form = screen.getByTestId('form') as HTMLFormElement
    expect(form).toHaveAttribute('action', '/api/auth/sign-out')
    expect(form.method).toBe('post')
  })
})

describe('account menu: Sign out', () => {
  it('is a real menu item that turns red, like the dashboard menu', async () => {
    render(<AccountMenu email="signed-in-user" initials="AB" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Account menu' }), { key: 'Enter' })

    // It is a menu item only because SignOutForm passes Radix's role on to the form.
    const item = await screen.findByRole('menuitem', { name: 'Sign out' })
    expect(item.tagName).toBe('FORM')
    expect(item.className).toContain('text-destructive')
    expect(item.className).toContain('focus:bg-destructive/10')
    expect(item.className).toContain('focus:text-destructive')
  })
})
