import { useLocale } from 'next-intl'
import { pageMetadata } from '@/lib/seo'
import { DEFAULT_LOCALE, localeDirection } from '@/i18n/locales'
import { Link } from '@/i18n/navigation'
import { LegalToc } from '@/components/legal-toc'
import { BACKUP_FILE_COPY } from '@tabmerger/shared'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import { CookieSettingsButton } from '@/components/consent/CookieSettingsButton'

// English only, under every locale: this is the binding text, so it is not translated (and not
// in the message catalog). Its canonical is the English URL and only English is listed as an
// alternate; the rest of the page (navbar, footer) follows the visitor's language.
export function generateMetadata() {
  return pageMetadata({
    path: '/privacy',
    title: 'Privacy Policy',
    description: 'How TabMerger collects, uses, and protects your data.',
    englishOnly: true,
  })
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
  // Marks the English text as English inside a page in another language (nothing on English
  // pages), and keeps it left to right inside a right-to-left page.
  const locale = useLocale()
  const lang = locale === DEFAULT_LOCALE ? undefined : DEFAULT_LOCALE
  const dir = localeDirection(locale) === 'rtl' ? 'ltr' : undefined
  return (
    <div className="container py-16 max-w-5xl" lang={lang} dir={dir}>
      {/* Header — brand-soft callout, distinct from Terms' neutral treatment */}
      <div className="mb-11 rounded-none bg-accent border border-primary/20 px-8 py-7">
        <h1 className="text-[34px] font-semibold tracking-tight mb-2.5">Privacy, in plain English</h1>
        <p className="max-w-xl text-[15.5px] text-text2 leading-relaxed">
          TabMerger is an indie product. We collect only what we need to operate the service, we
          never sell it, and you can delete all of it at any time. Questions?{' '}
          <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">Contact us</Link>.
        </p>
        <div className="mt-3.5 text-xs text-text3">Last updated: October 22, 2026</div>
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
              <p>Tab URLs, titles, and favicon URLs so you can organize and restore them. On the free tier this data lives in your browser's IndexedDB and is not transmitted to our servers, except as described under "Page previews" below if you turn that feature on. Showing a tab&apos;s icon can contact Google&apos;s favicon service; see <a href="#site-icons" className="underline underline-offset-4 hover:text-foreground transition-colors">Site icons</a> below. Pro subscribers who enable cloud sync have this data end-to-end encrypted on your device before it is ever sent to our servers. We store only ciphertext in Supabase: the encryption key is derived from a passphrase that only you know, is never transmitted to us, and is never recoverable by TabMerger. This means we cannot read your stored or synced group or tab data, and neither could anyone who gained unauthorized access to our database.</p>
            </div>
            <div id="site-icons" className="scroll-mt-24">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Site icons (favicons)</h3>
              <p>TabMerger shows a small site icon next to each tab. When your browser supplies the icon, it is loaded from the address the site itself uses for it. When your browser doesn&apos;t supply one, TabMerger asks Google&apos;s favicon service for it: your browser then sends that site&apos;s domain (for example <code className="text-xs bg-muted px-1.5 py-0.5 rounded">example.com</code>; never the full page address, the tab&apos;s title or anything on the page) to Google whenever the icon is shown, in the extension, on your dashboard or on a shared link&apos;s page. The request goes straight from your browser to Google, so Google sees your IP address as any website you load does. It carries no TabMerger account or identifier, and it never passes through our servers.</p>
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
              <p>When you use AI features, the titles and URLs of the tabs involved are sent through TabMerger&apos;s server to an AI provider to generate a response, over encrypted connections. When TabMerger handles setup, that provider is Anthropic (the Claude API). Anthropic does not use API request content to train its models and does not retain it beyond their standard API data handling terms. Tab content is not stored by us beyond what you have already saved in your groups.</p>
              <p className="mt-3"><span className="font-medium text-foreground">Your own API key.</span> When you handle setup with your own API key, those titles and URLs go through our server to the provider that issued your key: Anthropic, OpenAI or Google. The provider&apos;s own terms and privacy policy then apply to that request, and it bills you directly. Your key is kept only in the extension on your device and is sent with each AI request; our server passes it straight to the provider and never stores or logs it.</p>
            </div>
            <div id="uninstall-survey" className="scroll-mt-24">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">If you remove the extension</h3>
              <p>When you remove TabMerger, your browser opens a short page on our site asking why. The page address tells us only the extension&apos;s version, which browser it was for, whether it was the regular or the beta release, and whether the extension was allowed to send anonymous usage statistics; nothing about you, your account or your tabs is in it. If it was allowed, our server records one anonymous &quot;extension removed&quot; count in Google Analytics with that version, browser and release, under a random identifier made up for that one count. (Like every page on this site, the page is also counted by the web analytics described below.) Answering is optional. Only if you press send does the form send the reasons you ticked, anything you wrote, and an email address if you chose to give one so we can reply. That answer is emailed to our support inbox through Resend, along with the same basic details as the contact form (which site version and page it came from, your browser name and language), but never your IP address. We use it only to understand why people leave and, if you asked, to reply.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-1.5">Analytics</h3>
              <p>We use Google Analytics 4 on the website to collect aggregate usage patterns (page views, feature usage). We do not link this data to your account identity, and no personally identifiable information is sent to Google. We also use PostHog for product analytics and session replay on the website (see <a href="#session-replay" className="underline underline-offset-4 hover:text-foreground transition-colors">Session replay</a> below); this data is likewise not linked to your account. Whether they run before you make a choice depends on where you are (see <a href="#cookie-consent" className="underline underline-offset-4 hover:text-foreground transition-colors">Cookies and local storage</a>): in the European Economic Area, the United Kingdom, Switzerland and Quebec, neither loads at all until you accept; everywhere else both are on by default and you can turn them off at any time. If you reject, or your browser sends a Global Privacy Control signal and you haven&apos;t accepted, neither runs. On the website we also use Vercel Web Analytics, which counts page views without cookies, and Vercel Speed Insights, which measures how fast pages load; neither is linked to your account, and the part of an address after <code className="text-xs bg-muted px-1.5 py-0.5 rounded">#</code> (a shared link&apos;s decryption key) is removed before either reports it.</p>
              <p id="session-replay" className="mt-3 scroll-mt-24"><span className="font-medium text-foreground">Session replay.</span> While analytics are on for you, PostHog records how the website&apos;s pages are used so we can find what&apos;s confusing or broken: the pages you open, what they show, and your clicks, scrolling and mouse movements, along with your browser, device type and approximate location (from your IP address). Everything you type into a form field, such as an email address or a password, is masked in your browser, so the recording never contains it. Your dashboard and the tabs on a shared link&apos;s page are left out of recordings, and the part of a shared link after <code className="text-xs bg-muted px-1.5 py-0.5 rounded">#</code> (its decryption key) is removed from the addresses PostHog receives. Recordings run only while analytics are on: never before you accept in the regions above, never after you reject, and never while your browser sends Global Privacy Control unless you accepted. To stop a recording, press Reject in <span className="font-medium text-foreground">Cookie settings</span>; it stops straight away.</p>
              <p className="mt-3">The browser extension sends anonymous usage events too: when it is installed or updated, about once a day while it stays installed (so we can count active installs), and when you use certain features (for example creating a group or using search). Each event carries only its name, the extension&apos;s version and browser, whether it is the regular or the beta release, and simple counts or labels, never your tabs&apos; addresses, titles or group names. Events are tagged with a random install identifier created by the extension and kept in its own storage, not with your account. They go to our server, which forwards them to Google Analytics, so the extension itself never contacts Google Analytics. On Firefox, nothing is sent unless you allowed &quot;technical and interaction data&quot; when installing (you can change this in Firefox&apos;s add-on settings).</p>
            </div>
          </div>
        </section>

        <section id="page-previews" className="scroll-mt-24">
          <h2 className="text-xl font-semibold mb-4">2. Page Previews</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>Page previews let you see a small image and description of a tab's page when you hover over it — in the extension's tab preview tooltip, or on a shared link's page. This feature is <strong>off by default</strong> and must be explicitly turned on, either in the extension's Settings or via the "Show page previews" switch on a shared link's page.</p>
            <p>When turned on, hovering a tab sends that tab's web address to TabMerger's preview service (a serverless function we run on Vercel). That service fetches the page's <code className="text-xs bg-muted px-1.5 py-0.5 rounded">og:image</code> and description on your behalf and returns them to you. The address you send:</p>
            <ul className="list-disc ps-5 space-y-1">
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
              <span className="text-muted-foreground">Tab and group data in browser IndexedDB, under your control. Not transmitted anywhere unless you enable sync, or send a specific tab's address to the preview service by turning on page previews (see "Page previews" above). One exception: showing a tab's icon can send that site's domain to Google's favicon service (see "Site icons" above).</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Backup files (optional)</span>
              <span className="text-muted-foreground">If you turn on &quot;{BACKUP_FILE_COPY.toggle}&quot;, each automatic backup is also written as a JSON file inside your browser&apos;s Downloads folder. That file is not encrypted and stays on your computer: TabMerger does not upload it, read other files, or delete it. It contains your saved groups (tab addresses and titles, group and window names, notes) and nothing about your account.</span>
            </div>
            <div className="flex gap-4 px-4 py-3">
              <span className="font-medium w-40 shrink-0">Supabase (Pro)</span>
              <span className="text-muted-foreground">Account profile in a PostgreSQL database, encrypted at rest and in transit by our infrastructure. Groups and sessions (including automatic backups, which Pro accounts get by default and can turn off: they are saved as sessions, and the extension downloads them again to restore them on a new or reinstalled browser) are additionally end-to-end encrypted client-side before upload — we store only ciphertext and never hold the key, so this content is unreadable to us.</span>
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
              { name: 'Sentry', purpose: 'Error monitoring on the website: stack traces and metadata, with page and request URLs removed from error reports. It also records a replay of a small share of visits and of visits where an error occurs, with all text masked and images blocked; the part of an address after # (the decryption key of a shared link) is removed from everything it records.', url: 'https://sentry.io/privacy/' },
              { name: 'Anthropic', purpose: 'Claude API for AI features (Pro AI tier only), when TabMerger handles setup or with your own Anthropic key', url: 'https://www.anthropic.com/privacy' },
              { name: 'OpenAI', purpose: 'AI features, only for Pro AI subscribers who use their own OpenAI API key', url: 'https://openai.com/policies/privacy-policy/' },
              { name: 'Google AI (Gemini API)', purpose: 'AI features, only for Pro AI subscribers who use their own Google API key', url: 'https://policies.google.com/privacy' },
              { name: 'Google Analytics', purpose: 'Anonymous aggregate analytics on the website. Asks first in the EEA, the UK, Switzerland and Quebec; on by default elsewhere until you reject', url: 'https://policies.google.com/privacy' },
              { name: 'Google favicon service', purpose: "Site icons for tabs whose icon your browser doesn't supply. Receives the site's domain only, directly from your browser.", url: 'https://policies.google.com/privacy' },
              { name: 'PostHog', purpose: 'Product analytics and session replay on the website, with every form input masked. Same rules as Google Analytics: asks first in the EEA, the UK, Switzerland and Quebec; on by default elsewhere until you reject', url: 'https://posthog.com/privacy' },
              { name: 'Resend', purpose: 'Delivers messages you send us from the contact form or the page shown after removing the extension to our support inbox', url: 'https://resend.com/legal/privacy-policy' },
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
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <div id="cookie-consent" className="scroll-mt-24 space-y-3">
              <p>What happens on your first visit depends on where you are, which our host works out from your IP address:</p>
              <ul className="list-disc ps-5 space-y-1">
                <li id="consent-ask-first"><span className="font-medium text-foreground">Asked first</span> in the European Economic Area (the EU, Norway, Iceland and Liechtenstein), the United Kingdom (with the Channel Islands, the Isle of Man and Gibraltar), Switzerland and Quebec, and whenever we can&apos;t tell where you are. A small banner at the bottom of the page asks whether you accept analytics cookies, and nothing is loaded before you answer: Google Analytics and PostHog don&apos;t run, set no cookies and record nothing until you press Accept. <span className="font-medium text-foreground">Accept</span> and <span className="font-medium text-foreground">Reject</span> are equal choices, and the site works the same either way.</li>
                <li id="consent-on-by-default"><span className="font-medium text-foreground">On by default</span> everywhere else. No banner appears; Google Analytics and PostHog (including session replay) run and set their cookies as described above. You can turn them off at any time with Reject in <span className="font-medium text-foreground">Cookie settings</span>.</li>
                <li id="consent-gpc"><span className="font-medium text-foreground">Global Privacy Control.</span> If your browser sends a Global Privacy Control signal, we treat it as a Reject wherever you are: analytics stay off and no banner asks you. They come on only if you press Accept in Cookie settings yourself.</li>
              </ul>
              <p>You can change your choice at any time with <span className="font-medium text-foreground">Cookie settings</span> at the bottom of every page, or here: <CookieSettingsButton label="Cookie settings" className="cursor-pointer font-medium text-foreground underline underline-offset-4 hover:text-primary" />. A change applies straight away: after Reject, Google Analytics stops sending, PostHog stops capturing and recording for the rest of your visit, and the analytics cookies set earlier are deleted.</p>
            </div>
            <p>The TabMerger website sets these cookies:</p>
            <ul className="list-disc ps-5 space-y-1">
              <li id="cookie-sign-in"><span className="font-medium text-foreground">Sign-in</span> (Supabase Auth, names starting with <code className="text-xs bg-muted px-1.5 py-0.5 rounded">sb-</code>): keep you signed in to the web app. They are set only when you sign in and removed when you sign out.</li>
              <li id="cookie-language"><span className="font-medium text-foreground">Language</span> (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">NEXT_LOCALE</code>): remembers the language you chose, or the one you last browsed the site in, so the site opens in that language next time. It holds only a language code such as <code className="text-xs bg-muted px-1.5 py-0.5 rounded">de</code> and lasts one year.</li>
              <li id="cookie-choice"><span className="font-medium text-foreground">Cookie choice</span> (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">tm_consent</code>): remembers whether you accepted or rejected analytics cookies, so you aren&apos;t asked again on every visit. It is set only when you press Accept or Reject, holds only <code className="text-xs bg-muted px-1.5 py-0.5 rounded">granted</code> or <code className="text-xs bg-muted px-1.5 py-0.5 rounded">denied</code>, and lasts one year.</li>
              <li id="cookie-region"><span className="font-medium text-foreground">Consent region</span> (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">tm_consent_region</code>): tells the page whether to ask before analytics run where you are. It is strictly necessary, holds only <code className="text-xs bg-muted px-1.5 py-0.5 rounded">optin</code> (ask first) or <code className="text-xs bg-muted px-1.5 py-0.5 rounded">optout</code> (on by default), never your country or IP address, and lasts one day, so it is checked again if you travel.</li>
              <li id="cookie-analytics"><span className="font-medium text-foreground">Analytics</span> (only while analytics are on for you, see above): Google Analytics sets <code className="text-xs bg-muted px-1.5 py-0.5 rounded">_ga</code> cookies holding its anonymous client identifier (kept for up to two years), and PostHog sets a <code className="text-xs bg-muted px-1.5 py-0.5 rounded">ph_…_posthog</code> cookie with its own identifier. See &quot;Analytics&quot; above for what they collect.</li>
            </ul>
            <p>We do not use advertising cookies. The website also keeps a few settings in your browser&apos;s local storage, such as your light or dark theme, the dashboard&apos;s grid or list view and whether page previews are on for shared links; these stay in your browser and are not sent to us. While you use the dashboard, the key that decrypts your synced data is kept in session storage, which your browser clears when you close the tab. While analytics are on, PostHog also keeps its identifier in local storage; the error-monitoring tool keeps its own in local or session storage. The extension stores its data in IndexedDB and <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome.storage.local</code>, not in browser cookies.</p>
          </div>
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
          <p className="text-muted-foreground text-sm">For privacy-related questions or requests, use our <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact page</Link> or email <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4 hover:text-foreground transition-colors">{SUPPORT_EMAIL}</a>.</p>
        </section>

        <div className="pt-6 border-t flex gap-4 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service →</Link>
        </div>
      </div>
      </div>
    </div>
  )
}
