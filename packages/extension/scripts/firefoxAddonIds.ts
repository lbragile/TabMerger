/**
 * Firefox add-on IDs (`browser_specific_settings.gecko.id`). AMO identifies an add-on only by
 * this ID, so these must never change once published.
 */

/** The live listing, https://addons.mozilla.org/firefox/addon/tabmerger/ (GUID from AMO's API). */
export const FIREFOX_STABLE_ADDON_ID = "{19feb84f-3a0b-4ca3-bbae-211b52eb158b}";

/** The unlisted beta add-on (separate, so beta and stable can be installed side by side). */
export const FIREFOX_BETA_ADDON_ID = "tabmerger-beta@lbragile.com";
