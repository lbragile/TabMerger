/**
 * Right-to-left support in the web app (docs/I18N.md, "Right-to-left"): which locales are RTL,
 * the Radix direction context fed from the locale, the script font per locale, and content that
 * keeps its own direction instead of the page's (inputs, synced and shared data, English legal
 * text). The carousel's direction is covered in ReviewsCarousel.test.tsx and the physical-class
 * guard in rtl-logical-classes.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import * as Tabs from '@radix-ui/react-tabs'
import { DirectionProvider } from '@radix-ui/react-direction'
import { LOCALES, PSEUDO_LOCALE, RTL_LOCALES, localeDirection, type AppLocale } from '@/i18n/locales'
import { LocaleDirectionProvider, useDirection } from '@/components/DirectionProvider'
import { Input, inputDirection } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PasswordInput } from '@/components/ui/password-input'
import { SessionGroupsPreview } from '@/components/dashboard/SessionCard'
import PrivacyPage from '@/app/[locale]/(marketing)/privacy/page'
import TermsPage from '@/app/[locale]/(marketing)/terms/page'
import en from '@/messages/en'

// next/font is a compiler transform: each loader stands in as a class named after the font.
vi.mock('next/font/google', () => {
  const font = (name: string) => () => ({ variable: `font-${name}`, className: name, style: {} })
  return {
    Geist: font('geist'),
    Geist_Mono: font('geist-mono'),
    Noto_Sans_Arabic: font('noto-sans-arabic'),
    Noto_Sans_Hebrew: font('noto-sans-hebrew'),
  }
})

describe('localeDirection', () => {
  it('is right to left for Arabic, Hebrew and Persian', () => {
    expect(RTL_LOCALES).toEqual(['ar', 'he', 'fa'])
    for (const locale of ['ar', 'he', 'fa']) expect(localeDirection(locale)).toBe('rtl')
  })

  it('is left to right for every other locale, Urdu (not shipped) and the pseudo-locale included', () => {
    for (const locale of LOCALES.filter((l) => !RTL_LOCALES.includes(l))) expect(localeDirection(locale)).toBe('ltr')
    expect(localeDirection('ur')).toBe('ltr')
    expect(localeDirection(PSEUDO_LOCALE)).toBe('ltr')
  })
})

describe('LocaleDirectionProvider', () => {
  function Probe() {
    return <span data-testid="dir">{useDirection()}</span>
  }

  it('gives our own components the locale direction', () => {
    const { unmount } = render(
      <LocaleDirectionProvider locale="ar">
        <Probe />
      </LocaleDirectionProvider>
    )
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl')
    unmount()
    render(
      <LocaleDirectionProvider locale="de">
        <Probe />
      </LocaleDirectionProvider>
    )
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr')
  })

  it('reaches the Radix primitives: they share its context (one copy of @radix-ui/react-direction)', () => {
    render(
      <LocaleDirectionProvider locale="he">
        <Tabs.Root defaultValue="a" data-testid="tabs">
          <Tabs.List>
            <Tabs.Trigger value="a">A</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>
      </LocaleDirectionProvider>
    )
    expect(screen.getByTestId('tabs')).toHaveAttribute('dir', 'rtl')
  })

  it('defaults to left to right with no provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('dir')).toHaveTextContent('ltr')
  })
})

describe('scriptFontClass', () => {
  it('adds Noto Sans Arabic for Arabic and Persian, Noto Sans Hebrew for Hebrew', async () => {
    const { scriptFontClass } = await import('@/lib/fonts')
    expect(scriptFontClass('ar')).toBe('font-noto-sans-arabic')
    expect(scriptFontClass('fa')).toBe('font-noto-sans-arabic')
    expect(scriptFontClass('he')).toBe('font-noto-sans-hebrew')
    expect(scriptFontClass('ar-EG')).toBe('font-noto-sans-arabic')
  })

  it('adds nothing for a locale Geist covers, so those visitors load no script font', async () => {
    const { scriptFontClass } = await import('@/lib/fonts')
    for (const locale of ['en', 'de', 'ru', 'vi', 'ja', PSEUDO_LOCALE, 'ur']) expect(scriptFontClass(locale)).toBe('')
  })
})

describe('input direction', () => {
  it('is auto for free text, ltr for addresses, and the page direction otherwise', () => {
    expect(inputDirection(undefined)).toBe('auto')
    expect(inputDirection('text')).toBe('auto')
    expect(inputDirection('search')).toBe('auto')
    expect(inputDirection('email')).toBe('ltr')
    expect(inputDirection('url')).toBe('ltr')
    expect(inputDirection('tel')).toBe('ltr')
    expect(inputDirection('password')).toBeUndefined()
    expect(inputDirection('checkbox')).toBeUndefined()
  })

  it('is applied by Input and Textarea, and a caller can still choose', () => {
    render(
      <>
        <Input aria-label="name" />
        <Input aria-label="email" type="email" />
        <Input aria-label="forced" dir="rtl" />
        <Textarea aria-label="message" />
      </>
    )
    expect(screen.getByLabelText('name')).toHaveAttribute('dir', 'auto')
    expect(screen.getByLabelText('email')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByLabelText('forced')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByLabelText('message')).toHaveAttribute('dir', 'auto')
  })

  it('keeps a password field in the page direction, hidden or shown, so its padding is on the button side', () => {
    render(
      <DirectionProvider dir="rtl">
        <PasswordInput aria-label="passphrase" visible />
      </DirectionProvider>
    )
    const input = screen.getByLabelText('passphrase')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('dir', 'rtl')
  })
})

describe('synced content keeps its own direction', () => {
  it('renders group names and tab titles with dir="auto" on the truncating box', () => {
    render(
      <SessionGroupsPreview
        groups={[{ name: 'مجموعة', windows: [{ tabs: [{ title: 'Docs', url: 'https://example.test/' }] }] }]}
      />
    )
    const name = screen.getByText('مجموعة')
    expect(name).toHaveAttribute('dir', 'auto')
    expect(name).toHaveClass('truncate', 'text-start')
    const title = screen.getByText('Docs')
    expect(title).toHaveAttribute('dir', 'auto')
    // The ellipsis comes from the element that clips: it must carry the text's own direction.
    expect(title).toHaveClass('truncate', 'text-start')
    // The indent stays on the page's start side, outside the text's own direction.
    expect(title.parentElement).toHaveClass('ps-4')
    expect(title.parentElement).not.toHaveAttribute('dir')
  })
})

describe('English legal text inside a right-to-left page', () => {
  const inLocale = (locale: AppLocale) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <NextIntlClientProvider locale={locale} messages={en}>
          {children}
        </NextIntlClientProvider>
      )
    }

  it.each([
    ['privacy', PrivacyPage],
    ['terms', TermsPage],
  ])('marks the %s page lang="en" dir="ltr" in Arabic, and nothing in English', (_, Page) => {
    const { container, unmount } = render(<Page />, { wrapper: inLocale('ar') })
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('lang', 'en')
    expect(root).toHaveAttribute('dir', 'ltr')
    unmount()

    const english = render(<Page />, { wrapper: inLocale('en') })
    const englishRoot = english.container.firstElementChild as HTMLElement
    expect(englishRoot).not.toHaveAttribute('lang')
    expect(englishRoot).not.toHaveAttribute('dir')
  })

  it('marks it lang="en" but leaves the direction alone in a left-to-right language', () => {
    const { container } = render(<PrivacyPage />, { wrapper: inLocale('de') })
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute('lang', 'en')
    expect(root).not.toHaveAttribute('dir')
  })
})
