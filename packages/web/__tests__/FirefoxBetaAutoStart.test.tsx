import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startFile } = vi.hoisted(() => ({ startFile: vi.fn() }))
vi.mock('@/lib/startFile', () => ({ startFile }))

import { FirefoxBetaAutoStart } from '@/components/beta/FirefoxBetaAutoStart'
import { BETA_STORE_LINKS } from '@/lib/storeLinks'

const XPI = '/firefox-beta/tabmerger-beta.xpi'

function arriveAt(path: string) {
  window.history.pushState({}, '', path)
}

function address() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

describe('FirefoxBetaAutoStart', () => {
  beforeEach(() => {
    startFile.mockClear()
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('starts the beta file once when arriving from a Firefox install button', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(startFile).toHaveBeenCalledTimes(1)
    expect(startFile).toHaveBeenCalledWith(XPI)
  })

  it('removes the flag from the address and keeps the visitor on the Firefox step', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(address()).toBe('/beta#firefox')
  })

  it('removes the flag before starting the file, so nothing can start it twice', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    let addressAtStart = ''
    startFile.mockImplementationOnce(() => {
      addressAtStart = address()
    })
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(addressAtStart).toBe('/beta#firefox')
  })

  it('does not start it again on a re-render, a remount (reload, Back) or under StrictMode', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    const first = render(
      <StrictMode>
        <FirefoxBetaAutoStart xpiHref={XPI} />
      </StrictMode>
    )
    first.rerender(
      <StrictMode>
        <FirefoxBetaAutoStart xpiHref={XPI} />
      </StrictMode>
    )
    first.unmount()
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(startFile).toHaveBeenCalledTimes(1)
  })

  it('says what is happening and points at the explicit install link', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/The Firefox beta should start on its own/)
    expect(status).toHaveTextContent(/If nothing happens, use "Install the Firefox beta" in this step/)
  })

  it('keeps other query parameters', () => {
    arriveAt('/beta?utm_source=home&download=firefox#firefox')
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(address()).toBe('/beta?utm_source=home#firefox')
    expect(startFile).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when the file is not configured, and still cleans the address', () => {
    arriveAt(BETA_STORE_LINKS.firefox)
    render(<FirefoxBetaAutoStart xpiHref={null} />)

    expect(startFile).not.toHaveBeenCalled()
    expect(address()).toBe('/beta#firefox')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('does nothing without the flag', () => {
    arriveAt('/beta#firefox')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(startFile).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
    expect(address()).toBe('/beta#firefox')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    replaceState.mockRestore()
  })

  it('ignores a flag asking for anything other than the Firefox beta', () => {
    arriveAt('/beta?download=chrome#firefox')
    render(<FirefoxBetaAutoStart xpiHref={XPI} />)

    expect(startFile).not.toHaveBeenCalled()
    expect(address()).toBe('/beta?download=chrome#firefox')
  })
})
