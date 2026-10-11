/**
 * The extension's public store items: their IDs and listing pages. These are public values (an
 * item ID is part of its listing URL), kept here so the website, docs and tests never repeat
 * them as literals. Which listing the website links to is decided in the web app
 * (`lib/storeLinks.ts`), not here.
 */

/** Chrome Web Store item IDs. The same ID applies in every Chromium browser that installs from it. */
export const CHROME_EXTENSION_ID = {
  /** The public "TabMerger" item. */
  STABLE: 'inmiajapbpafmhjleiebcamfhkfnlgoc',
  /** The private "TabMerger BETA" item (visible only to members of the tester group). */
  BETA: 'nboljhidpjakiohfdkdjkcljdehcapcd',
} as const;

/** Edge Add-ons product ID of the public "TabMerger" item. There is no Edge beta item. */
export const EDGE_EXTENSION_ID = 'eogjdfjemlgmbblgkjlcgdehbeoodbfn';

/** Slug of the public addons.mozilla.org listing: the last path segment of its URL. */
export const FIREFOX_LISTING_SLUG = 'tabmerger';

/**
 * Public JSON describing the Edge Add-ons item, including its `averageRating`, `ratingCount` and
 * `storeProductId`. Edge has no documented ratings API; this is the endpoint its own listing
 * page reads.
 */
export const EDGE_PRODUCT_DETAILS_URL = `https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${EDGE_EXTENSION_ID}`;

/**
 * Base of the public JSON the Edge listing page reads its reviews from. The item is addressed by
 * the `storeProductId` that `EDGE_PRODUCT_DETAILS_URL` returns (`<base>/<storeProductId>?…`), so
 * `EDGE_EXTENSION_ID` stays the only Edge ID written down.
 */
export const EDGE_REVIEWS_API_URL = 'https://ratingsedge.rnr.microsoft.com/v1.0/ratingsedge/product';

/** Listing pages a visitor installs from. */
export const STORE_LISTING_URL = {
  /** Public Chrome Web Store listing. */
  CHROME_STABLE: `https://chromewebstore.google.com/detail/${CHROME_EXTENSION_ID.STABLE}`,
  /**
   * Private Chrome Web Store BETA listing. Members of the tester group see it; everyone else
   * gets "Item not found". Edge and the other Chromium browsers install the beta from here too.
   */
  CHROME_BETA: `https://chromewebstore.google.com/detail/tabmerger-beta/${CHROME_EXTENSION_ID.BETA}`,
  /** Public addons.mozilla.org listing. The Firefox beta is unlisted and has no listing page. */
  FIREFOX_STABLE: `https://addons.mozilla.org/firefox/addon/${FIREFOX_LISTING_SLUG}/`,
  /** Public Edge Add-ons listing. The product ID is required: the slug alone answers 404. */
  EDGE_STABLE: `https://microsoftedge.microsoft.com/addons/detail/tabmerger/${EDGE_EXTENSION_ID}`,
} as const;
