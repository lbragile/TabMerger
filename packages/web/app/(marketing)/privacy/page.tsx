import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalToc } from '@/components/legal-toc'

export const metadata: Metadata = {
  title: 'Privacy Policy — TabMerger',
  description: 'How TabMerger collects, uses, and protects your data.',
}

const TOC = [
  { id: 'what-we-collect', label: 'What we collect' },
  { id: 'page-previews', label: 'Page previews' },
  { id: 'how-stored', label: 'How data is stored' },
  { id: 'third-party', label: 'Third-party processors' },
  { id: 'retention', label: 'Data retention' },
  { id: 'your-rights', label: 'Your rights' },
  { id: 'cookies', label: 'Cookies & storage' },
  { id: 'children', label: "Children's privacy" },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact' },
]

export default function PrivacyPage() {
  return (
    <div className="container py-16 max-w-5xl">
      {/* Header — brand-soft callout, distinct from Terms' neutral treatment */}
      <div className="mb-11 rounded-none bg-accent border border-primary/20 px-8 py-7">
        <h1 className="text-[34px] font-semibold tracking-tight mb-2.5">Privacy, in plain English</h1>
        <p className="max-w-xl text-[15.5px] text-text2 leading-relaxed">
          TabMerger is an indie product. We collect only what we need to operate the service, we
          never sell it, and you can delete all of it at any time. Questions?{' '}
          <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">Contact us</Link>.
        </p>
        <div className="mt-3.5 text-xs text-text3">Last updated: September 26, 2026</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12 items-start">
        {/* Sticky TOC — wide screens only */}
        <LegalToc items={TOC} heading="On this page" />

      <div className="space-y-10 max-w-2xl">
        <section id="what-we-collect" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">1. What We Collect and Why</h2>
          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Account information</h3>
              <p>Your email address, stored via Supabase Auth. Used to identify your account, send transactional emails (e.g. password reset), and link your subscription to your data.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Tab and group data</h3>
              <p>Tab URLs, titles, and favicon URLs so you can organize and restore them. On the free tier this data lives in your browser's IndexedDB and is not transmitted to our servers, except as described under "Page previews" below if you turn that feature on. Pro subscribers who enable cloud sync have this data end-to-end encrypted on your device before it is ever sent to our servers. We store only ciphertext in Supabase: the encryption key is derived from a passphrase that only you know, is never transmitted to us, and is never recoverable by TabMerger. This means we cannot read your stored or synced group or tab data, and neither could anyone who gained unauthorized access to our database.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Page previews <span className="normal-case font-normal">(off by default)</span></h3>
              <p>Off by default. When you turn on preview images — in the extension's Settings, or on a shared link's page — hovering a tab sends that tab's web address to TabMerger's preview service, which fetches the page's preview image and description and returns them to you. The address isn't linked to your account, isn't logged, and isn't stored. You can turn this off at any time. See <a href="#page-previews" className="underline underline-offset-4 hover:text-foreground transition-colors">Page previews</a> below for details.</p>
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
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Analytics</h3>
              <p>We use Google Analytics 4 on the web app to collect aggregate usage patterns (page views, feature usage). GA4 assigns an anonymous client identifier and we do not link this data to your account identity. No personally identifiable information is sent to Google. We also use PostHog for product analytics and session replay on the web app, with all form inputs masked by default; this data is likewise not linked to your account beyond what's needed to improve the product. On the web app we also use Vercel Web Analytics, which counts page views without cookies, and Vercel Speed Insights, which measures how fast pages load; neither is linked to your account.</p>
            </div>
          </div>
        </section>

        <section id="page-previews" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">2. Page Previews</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>Page previews let you see a small image and description of a tab's page when you hover over it — in the extension's tab preview tooltip, or on a shared link's page. This feature is <strong>off by default</strong> and must be explicitly turned on, either in the extension's Settings or via the "Show page previews" switch on a shared link's page.</p>
            <p>When turned on, hovering a tab sends that tab's web address to TabMerger's preview service (a serverless function we run on Vercel). That service fetches the page's <code className="text-xs bg-muted px-1.5 py-0.5 rounded">og:image</code> and description on your behalf and returns them to you. The address you send:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>is sent without your account or any other identifier attached. Like any web request it reaches our host, Vercel, from your IP address, but we don&apos;t record or associate the two. The page itself is fetched by our server, so the site you&apos;re previewing sees our server, not you,</li>
              <li>is not logged anywhere by us,</li>
              <li>is not cached or stored, even temporarily — every preview request fetches the page fresh.</li>
            </ul>
            <p>You can turn page previews off at any time; when off, hovering a tab shows only information already available locally (title, URL, favicon, and any preview image already saved with that tab) and never contacts the preview service.</p>
          </div>
        </section>

        <section id="how-stored" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">3. How Data Is Stored</h2>
          <div className="divide-y divide-border rounded-none border overflow-hidden text-sm">
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Local (all tiers)</span>
              <span className="text-muted-foreground">Tab and group data in browser IndexedDB, under your control. Not transmitted anywhere unless you enable sync, or send a specific tab's address to the preview service by turning on page previews (see "Page previews" above).</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Supabase (Pro)</span>
              <span className="text-muted-foreground">Account profile in a PostgreSQL database, encrypted at rest and in transit by our infrastructure. Groups and sessions are additionally end-to-end encrypted client-side before upload — we store only ciphertext and never hold the key, so this content is unreadable to us.</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Stripe</span>
              <span className="text-muted-foreground">Payment and subscription data handled by Stripe (PCI DSS Level 1). We store only the customer ID and subscription metadata they return.</span>
            </div>
          </div>
        </section>

        <section id="third-party" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">4. Third-Party Processors</h2>
          <p className="text-muted-foreground text-sm mb-4">We share data with the following processors only to the extent necessary to operate the service.</p>
          <div className="divide-y divide-border rounded-none border overflow-hidden text-sm">
            {[
              { name: 'Supabase', purpose: 'Database, authentication, and file storage', url: 'https://supabase.com/privacy' },
              { name: 'Stripe', purpose: 'Payment processing and subscription management', url: 'https://stripe.com/privacy' },
              { name: 'Sentry', purpose: 'Error monitoring — stack traces and metadata only. All URLs and tab data are stripped via a beforeSend filter before any data leaves your device.', url: 'https://sentry.io/privacy/' },
              { name: 'Anthropic', purpose: 'Claude API for AI features (Pro AI tier only)', url: 'https://www.anthropic.com/privacy' },
              { name: 'Google Analytics', purpose: 'Anonymous aggregate analytics', url: 'https://policies.google.com/privacy' },
              { name: 'PostHog', purpose: 'Product analytics and session replay, with form inputs masked by default', url: 'https://posthog.com/privacy' },
              { name: 'Vercel', purpose: 'Hosting for the web app, plus Web Analytics (cookieless, aggregate page views) and Speed Insights (page performance metrics such as load time)', url: 'https://vercel.com/legal/privacy-policy' },
            ].map(({ name, purpose, url }) => (
              <div key={name} className="flex gap-4 px-4 py-3">
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium w-40 shrink-0 hover:underline">{name}</a>
                <span className="text-muted-foreground">{purpose}</span>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-sm mt-2">We do not sell your data to any third party.</p>
        </section>

        <section id="retention" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">5. Data Retention</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>We retain your account data for as long as your account is active. If you delete your account, all associated data stored in Supabase — including your profile, groups, and sessions — is permanently deleted.</p>
            <p>Local IndexedDB data remains in your browser until you clear it via browser settings or the TabMerger extension.</p>
            <p>Stripe may retain billing records for tax and compliance purposes in accordance with their own policies.</p>
          </div>
        </section>

        <section id="your-rights" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">6. Your Rights</h2>
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

        <section id="cookies" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">7. Cookies and Local Storage</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">TabMerger uses cookies solely for session management (Supabase Auth) when you are signed in to the web app. We do not use tracking or advertising cookies. The extension stores data in IndexedDB and <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome.storage.local</code>, not in browser cookies.</p>
        </section>

        <section id="children" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">8. Children's Privacy</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">TabMerger is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact us</Link> and we will delete it promptly.</p>
        </section>

        <section id="changes" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">9. Changes to This Policy</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">We may update this policy as the product evolves. Material changes will be communicated via email or a notice in the app. The "last updated" date at the top of this page will always reflect the most recent revision. Continued use of TabMerger after changes constitutes acceptance of the revised policy.</p>
        </section>

        <section id="contact" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">10. Contact</h2>
          <p className="text-muted-foreground text-sm">For privacy-related questions or requests, use our <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact page</Link>.</p>
        </section>

        <div className="pt-6 border-t flex gap-4 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service →</Link>
        </div>
      </div>
      </div>
    </div>
  )
}
