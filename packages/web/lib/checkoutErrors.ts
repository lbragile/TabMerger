/**
 * Error codes `POST /api/checkout` returns in `{ error }` that the pricing UI acts on.
 * Client-safe (no server imports): the route and `PricingCard` both read the code from here.
 */

/**
 * 409: the account already has a paid plan. An account holds one subscription, so a plan change
 * goes through the Billing Portal (which changes that subscription) and no Checkout Session is
 * created.
 */
export const ALREADY_SUBSCRIBED_ERROR = 'already_subscribed'
