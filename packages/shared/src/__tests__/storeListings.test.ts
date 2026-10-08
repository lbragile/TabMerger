import { describe, expect, it } from 'vitest';
import {
  CHROME_EXTENSION_ID,
  EDGE_EXTENSION_ID,
  EDGE_PRODUCT_DETAILS_URL,
  EDGE_REVIEWS_API_URL,
  FIREFOX_LISTING_SLUG,
  STORE_LISTING_URL,
} from '../constants/storeListings';

describe('store listings', () => {
  it('keeps the stable and BETA Chrome items apart', () => {
    expect(CHROME_EXTENSION_ID.STABLE).toBe('inmiajapbpafmhjleiebcamfhkfnlgoc');
    expect(CHROME_EXTENSION_ID.BETA).toBe('nboljhidpjakiohfdkdjkcljdehcapcd');
    expect(CHROME_EXTENSION_ID.STABLE).not.toBe(CHROME_EXTENSION_ID.BETA);
  });

  it('points each Chrome listing at its own item, never at the store home page', () => {
    expect(STORE_LISTING_URL.CHROME_STABLE).toBe(
      'https://chromewebstore.google.com/detail/inmiajapbpafmhjleiebcamfhkfnlgoc'
    );
    expect(STORE_LISTING_URL.CHROME_BETA).toBe(
      'https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd'
    );
  });

  it('links Firefox to the addons.mozilla.org listing', () => {
    expect(STORE_LISTING_URL.FIREFOX_STABLE).toBe('https://addons.mozilla.org/firefox/addon/tabmerger/');
  });

  it('links Edge to the listing that carries the product ID (the slug alone answers 404)', () => {
    expect(STORE_LISTING_URL.EDGE_STABLE).toBe(
      `https://microsoftedge.microsoft.com/addons/detail/tabmerger/${EDGE_EXTENSION_ID}`
    );
    expect(EDGE_EXTENSION_ID).toBe('eogjdfjemlgmbblgkjlcgdehbeoodbfn');
  });

  it('uses https for every listing', () => {
    for (const url of Object.values(STORE_LISTING_URL)) {
      expect(url.startsWith('https://')).toBe(true);
    }
  });

  it('builds the review-source URLs from the same IDs as the listing links', () => {
    expect(FIREFOX_LISTING_SLUG).toBe('tabmerger');
    expect(STORE_LISTING_URL.FIREFOX_STABLE).toContain(`/addon/${FIREFOX_LISTING_SLUG}/`);
    expect(EDGE_PRODUCT_DETAILS_URL).toBe(
      `https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${EDGE_EXTENSION_ID}`
    );
    expect(EDGE_REVIEWS_API_URL.startsWith('https://')).toBe(true);
    expect(EDGE_REVIEWS_API_URL).not.toContain(EDGE_EXTENSION_ID);
  });
});
