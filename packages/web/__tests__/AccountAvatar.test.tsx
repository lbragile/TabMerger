import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AccountAvatar, ACCOUNT_AVATAR_BUTTON_CLASS } from '@/components/layout/AccountAvatar'

// The navbar's and the dashboard's account menus must look the same: a slightly rounded square,
// not the circle the shared Avatar defaults to.
describe('AccountAvatar', () => {
  it('shows the initials in a rounded square, not a circle', async () => {
    const { container } = render(<AccountAvatar initials="LB" />)
    expect(await screen.findByText('LB')).toBeInTheDocument()
    const classes = Array.from(container.querySelectorAll('[class]')).map((el) => el.className).join(' ')
    expect(classes).toContain('rounded-md')
    expect(classes).not.toContain('rounded-full')
  })

  it('gives the trigger button the same square shape', () => {
    expect(ACCOUNT_AVATAR_BUTTON_CLASS).toContain('rounded-md')
    expect(ACCOUNT_AVATAR_BUTTON_CLASS).not.toContain('rounded-full')
  })
})

describe('AccountAvatar size', () => {
  it('is 36px (h-9) like the other controls in the header, not 32px', () => {
    expect(ACCOUNT_AVATAR_BUTTON_CLASS).toContain('h-9')
    expect(ACCOUNT_AVATAR_BUTTON_CLASS).toContain('w-9')
    const { container } = render(<AccountAvatar initials="LB" />)
    expect((container.firstElementChild as HTMLElement).className).toContain('h-9')
  })
})

describe('AccountAvatar — analytics privacy', () => {
  it('keeps the initials (taken from the email) out of analytics', () => {
    render(<AccountAvatar initials="LB" />)
    expect(screen.getByText('LB').closest('.ph-no-capture')).not.toBeNull()
  })
})
