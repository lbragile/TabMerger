'use client'

import { useEffect, useState } from 'react'
import { BETA_GUIDE_START_FIREFOX, BETA_GUIDE_START_PARAM } from '@/lib/storeLinks'
import { startFile } from '@/lib/startFile'

interface Props {
  /** Address of the Firefox beta file, or null when this deployment does not serve one. */
  xpiHref: string | null
}

/**
 * Lives in the Firefox step of the beta guide. When someone arrives from a "Firefox" install
 * button (`?download=firefox`), it starts the beta file once and says so.
 *
 * - The flag is removed from the address before anything else, so a reload, the Back button or
 *   a second run of this effect cannot start the file again.
 * - The file is started straight away, with no delay: Firefox only accepts an add-on install
 *   that still counts as coming from the visitor's click, which holds for a few seconds after a
 *   client-side navigation and not at all after a full page load (a pasted link, a reload).
 * - So the automatic start is a convenience. The status line always points at the step's own
 *   install link, which works with one click in every case.
 * - With no file configured it only cleans the address: no request, no message.
 */
export function FirefoxBetaAutoStart({ xpiHref }: Props) {
  const [arrivedToInstall, setArrivedToInstall] = useState(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get(BETA_GUIDE_START_PARAM) !== BETA_GUIDE_START_FIREFOX) return

    url.searchParams.delete(BETA_GUIDE_START_PARAM)
    // `null` state (not the current one) is what lets the Next router pick up the new address.
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)

    if (!xpiHref) return
    startFile(xpiHref)
    // Reading the address is a one-time read of an external system on arrival, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArrivedToInstall(true)
  }, [xpiHref])

  // Always in the DOM, so the text is announced when it appears.
  return (
    <span role="status" className={arrivedToInstall ? 'mt-2 block text-sm text-foreground' : undefined}>
      {arrivedToInstall
        ? 'The Firefox beta should start on its own: Firefox asks whether to add it, other browsers download the file. If nothing happens, use "Install the Firefox beta" in this step.'
        : ''}
    </span>
  )
}
