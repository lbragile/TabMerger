import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — TabMerger',
  description: 'How TabMerger collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      {/* Header */}
      <div className="mb-10 pb-8 border-b">
        <p className="text-sm text-muted-foreground mb-2">Legal</p>
        <h1 className="text-4xl font-bold tracking-tight mb-3">Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: July 16, 2026</p>
      </div>

      {/* Intro */}
      <div className="mb-10 p-4 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
        TabMerger is an indie product. We collect only what we need to operate the service and
        never sell your data. Questions? <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">Contact us</Link>.
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-4">1. What We Collect and Why</h2>
          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Account information</h3>
              <p>Your email address, stored via Supabase Auth. Used to identify your account, send transactional emails (e.g. password reset), and link your subscription to your data.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Tab and group data</h3>
              <p>Tab URLs, titles, and favicon URLs so you can organize and restore them. On the free tier this data lives exclusively in your browser's IndexedDB — it never leaves your device. Pro subscribers who enable cloud sync have this data stored in Supabase so it is available across devices.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Subscription and billing</h3>
              <p>Your Stripe customer ID and subscription status (tier, billing period, status). We never see or store your card number, CVV, or full payment details — those are handled entirely by Stripe.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">AI features <span className="normal-case font-normal">(Pro AI tier only)</span></h3>
              <p>When you use AI features, the titles and URLs of your open tabs are sent to the Anthropic Claude API to generate a response over an encrypted connection. Anthropic does not use API request content to train its models and does not retain it beyond their standard API data handling terms. Tab content is not stored by us beyond what you have already saved in your groups.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Analytics <span className="normal-case font-normal">(planned)</span></h3>
              <p>We plan to use Google Analytics 4 with an anonymous client ID stored in <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome.storage.local</code>. This will collect aggregate usage patterns without linking activity to your identity. No personally identifiable information will be sent. This feature is not yet active; this policy will be updated when it is enabled.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">2. How Data Is Stored</h2>
          <div className="divide-y divide-border rounded-lg border overflow-hidden text-sm">
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Local (all tiers)</span>
              <span className="text-muted-foreground">Tab and group data in browser IndexedDB. Under your control — not transmitted anywhere unless you enable sync.</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Supabase (Pro)</span>
              <span className="text-muted-foreground">Account profile, groups, and sessions in a PostgreSQL database. Encrypted at rest and in transit.</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Stripe</span>
              <span className="text-muted-foreground">Payment and subscription data handled by Stripe (PCI DSS Level 1). We store only the customer ID and subscription metadata they return.</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">3. Third-Party Processors</h2>
          <p className="text-muted-foreground text-sm mb-4">We share data with the following processors only to the extent necessary to operate the service.</p>
          <div className="divide-y divide-border rounded-lg border overflow-hidden text-sm">
            {[
              { name: 'Supabase', purpose: 'Database, authentication, and file storage', url: 'https://supabase.com/privacy' },
              { name: 'Stripe', purpose: 'Payment processing and subscription management', url: 'https://stripe.com/privacy' },
              { name: 'Sentry', purpose: 'Error monitoring — stack traces and metadata only. All URLs and tab data are stripped via a beforeSend filter before any data leaves your device.', url: 'https://sentry.io/privacy/' },
              { name: 'Anthropic *', purpose: 'Claude API for AI features (Pro AI tier only)', url: 'https://www.anthropic.com/privacy' },
              { name: 'Google Analytics *', purpose: 'Anonymous aggregate analytics', url: 'https://policies.google.com/privacy' },
            ].map(({ name, purpose, url }) => (
              <div key={name} className="flex gap-4 px-4 py-3">
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium w-40 shrink-0 hover:underline">{name}</a>
                <span className="text-muted-foreground">{purpose}</span>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs mt-3">* Planned — not yet active. This policy will be updated when enabled.</p>
          <p className="text-muted-foreground text-sm mt-2">We do not sell your data to any third party.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">4. Data Retention</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>We retain your account data for as long as your account is active. If you delete your account, all associated data stored in Supabase — including your profile, groups, and sessions — is permanently deleted.</p>
            <p>Local IndexedDB data remains in your browser until you clear it via browser settings or the TabMerger extension.</p>
            <p>Stripe may retain billing records for tax and compliance purposes in accordance with their own policies.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">5. Your Rights</h2>
          <p className="text-muted-foreground text-sm mb-4">Depending on where you reside, you may have rights under laws such as the GDPR (EU/UK) or CCPA (California):</p>
          <ul className="space-y-2 text-sm">
            {[
              { right: 'Access', desc: 'Request a copy of the personal data we hold about you.' },
              { right: 'Correction', desc: 'Ask us to correct inaccurate data.' },
              { right: 'Deletion', desc: 'Request deletion of your account and associated data.' },
              { right: 'Portability', desc: 'Request your data in a portable format.' },
              { right: 'Objection', desc: 'Object to certain processing activities.' },
            ].map(({ right, desc }) => (
              <li key={right} className="flex gap-3">
                <span className="font-medium w-24 shrink-0">{right}</span>
                <span className="text-muted-foreground">{desc}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm mt-4">To exercise any of these rights, <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact us</Link>. We will respond within 30 days.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">6. Cookies and Local Storage</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">TabMerger uses cookies solely for session management (Supabase Auth) when you are signed in to the web app. We do not use tracking or advertising cookies. The extension stores data in IndexedDB and <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome.storage.local</code>, not in browser cookies.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">7. Children's Privacy</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">TabMerger is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact us</Link> and we will delete it promptly.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">8. Changes to This Policy</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">We may update this policy as the product evolves. Material changes will be communicated via email or a notice in the app. The "last updated" date at the top of this page will always reflect the most recent revision. Continued use of TabMerger after changes constitutes acceptance of the revised policy.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">9. Contact</h2>
          <p className="text-muted-foreground text-sm">For privacy-related questions or requests, use our <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact page</Link>.</p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t flex gap-4 text-sm text-muted-foreground">
        <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service →</Link>
      </div>
    </div>
  )
}
