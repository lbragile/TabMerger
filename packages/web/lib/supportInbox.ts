/**
 * The public support address, safe to import from client components (no server imports).
 * It is on the Resend-verified `tabmerger.com` domain and forwards to the maintainer, so it is
 * both the default sender and the default inbox of `lib/supportEmail.ts` and the address the
 * site shows to people who would rather email than use the contact form.
 */
export const SUPPORT_EMAIL = 'support@tabmerger.com'
