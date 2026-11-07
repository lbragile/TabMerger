import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { SettingsSection, SETTINGS_SUB_BOX } from '@/components/Settings/SettingsSection'

describe('SettingsSection', () => {
  it('is a region named by its h3 heading', () => {
    render(<SettingsSection title="Backups" section="backups">body</SettingsSection>)
    const heading = screen.getByRole('heading', { level: 3, name: 'Backups' })
    const region = screen.getByRole('region', { name: 'Backups' })
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.id).not.toBe('')
  })

  it('gives each section its own heading id', () => {
    render(<><SettingsSection title="A" section="a" /><SettingsSection title="B" section="b" /></>)
    expect(screen.getByRole('heading', { name: 'A' }).id).not.toBe(screen.getByRole('heading', { name: 'B' }).id)
  })

  it('renders the purpose only when given', () => {
    const { rerender } = render(<SettingsSection title="T" section="t" purpose="What it is for" />)
    expect(screen.getByText('What it is for')).toBeTruthy()
    rerender(<SettingsSection title="T" section="t" />)
    expect(screen.queryByText('What it is for')).toBeNull()
  })

  it('puts the header action on the heading line, after the heading', () => {
    render(<SettingsSection title="T" section="t" headerAction={<button>Toggle</button>} />)
    const heading = screen.getByRole('heading', { name: 'T' })
    const action = screen.getByRole('button', { name: 'Toggle' })
    expect(heading.parentElement).toBe(action.parentElement)
    expect(heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('forwards data-section, testId, tabIndex and ref to the section element', () => {
    const ref = createRef<HTMLElement>()
    render(<SettingsSection ref={ref} title="T" section="danger" testId="sec" tabIndex={-1} className="extra">x</SettingsSection>)
    const el = screen.getByTestId('sec')
    expect(ref.current).toBe(el)
    expect(el.getAttribute('data-section')).toBe('danger')
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect(el.className).toContain('extra')
    el.focus()
    expect(document.activeElement).toBe(el)
  })

  it('exports the sub-box class string', () => {
    expect(SETTINGS_SUB_BOX).toContain('border')
  })
})
