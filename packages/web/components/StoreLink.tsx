import type { ComponentProps } from 'react'
import Link from 'next/link'
import { isExternalStoreLink, storeLinkProps } from '@/lib/storeLinks'

type StoreLinkProps = Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> & {
  /** One of the links from `getStoreLinks()`. */
  href: string
}

/**
 * An "install the extension" link.
 *
 * A store listing opens in a new tab. A link into this site (the Firefox beta, which goes to the
 * beta guide) is a Next `<Link>`: it must be a client-side navigation, not a full page load,
 * because the guide then starts the Firefox beta file and Firefox only accepts an add-on
 * install that still counts as coming from the visitor's click. A click stops counting once the
 * document is replaced.
 *
 * Works as the child of `<Button asChild>`: every other prop (className, ref) is passed through.
 */
export function StoreLink({ href, ...rest }: StoreLinkProps) {
  if (isExternalStoreLink(href)) {
    return <a {...rest} {...storeLinkProps(href)} />
  }
  return <Link {...rest} href={href} />
}
