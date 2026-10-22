/**
 * LocaleDirectionProvider: Radix primitives (menus, Select, Tabs, ScrollArea) take their reading
 * direction from it, and it must follow a language change made while the page is open (the
 * header's language menu applies at once). i18next has no right-to-left catalog registered in
 * these tests, so `i18n.dir` is spied on to stand in for Arabic / Hebrew / Persian.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { LocaleDirectionProvider, useUiDirection } from '@/components/LocaleDirectionProvider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { i18n } from '@/lib/i18n'

function Probe() {
  return <span data-testid="dir">{useUiDirection()}</span>
}

function Page() {
  return (
    <LocaleDirectionProvider>
      <Probe />
      <Tabs defaultValue="a" data-testid="tabs">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>
    </LocaleDirectionProvider>
  )
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await act(async () => {
    await i18n.changeLanguage('en')
  })
})

describe('LocaleDirectionProvider', () => {
  it('is left to right for a left-to-right language', () => {
    render(<Page />)
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    // A real Radix primitive reads it (Tabs mirrors it onto its root)
    expect(screen.getByTestId('tabs').getAttribute('dir')).toBe('ltr')
  })

  it('gives Radix primitives the right-to-left direction of the active language', () => {
    vi.spyOn(i18n, 'dir').mockReturnValue('rtl')
    render(<Page />)
    expect(screen.getByTestId('dir').textContent).toBe('rtl')
    expect(screen.getByTestId('tabs').getAttribute('dir')).toBe('rtl')
  })

  it('follows a language change made while the page is open', async () => {
    render(<Page />)
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
    const dir = vi.spyOn(i18n, 'dir').mockImplementation((lng?: string) => (lng === 'de' ? 'rtl' : 'ltr'))
    await act(async () => {
      await i18n.changeLanguage('de')
    })
    expect(dir).toHaveBeenCalledWith('de')
    expect(screen.getByTestId('dir').textContent).toBe('rtl')
    expect(screen.getByTestId('tabs').getAttribute('dir')).toBe('rtl')
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
  })

  it('useUiDirection is left to right outside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('dir').textContent).toBe('ltr')
  })
})
