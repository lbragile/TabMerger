import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — TabMerger',
  description: 'The terms and conditions for using TabMerger.',
}

export default function TermsPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      {/* Header */}
      <div className="mb-10 pb-8 border-b">
        <p className="text-sm text-muted-foreground mb-2">Legal</p>
        <h1 className="text-4xl font-bold tracking-tight mb-3">Terms of Service</h1>
        <p className="text-muted-foreground">Last updated: July 16, 2026</p>
      </div>

      {/* Intro */}
      <div className="mb-10 p-4 rounded-lg bg-muted/50 border text-sm text-muted-foreground">
        By installing the extension, creating an account, or using any part of TabMerger, you agree to these Terms. If you do not agree, do not use the service.
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-4">1. Description of Service</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>TabMerger is a tab management tool that lets you organize browser tabs into named groups, save and restore sessions, and sync your data across devices.</p>
            <p>The service is offered across Free, Pro, and Pro AI tiers. Full feature details and current pricing are listed on the <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground transition-colors">pricing page</Link>.</p>
            <p>We reserve the right to modify, expand, or discontinue features at any time. Significant changes that affect paid functionality will be communicated in advance.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">2. Accounts</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>To access Pro or Pro AI features, you must create an account with a valid email address. You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account.</p>
            <p>If you believe your account has been compromised, <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">contact us</Link> immediately.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">3. Subscriptions and Billing</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>Paid subscriptions are billed in advance on a monthly or annual cycle through Stripe. Your subscription renews automatically at the end of each billing period unless you cancel before the renewal date.</p>
            <p>Prices are listed in USD and are subject to change with at least 30 days' notice. Continued use after a price change takes effect constitutes agreement to the new price.</p>
            <p>We do not issue refunds for partial billing periods. If you cancel, you retain access to paid features until the end of your current billing period, after which your account reverts to the Free tier. No data is deleted on downgrade — data exceeding free tier limits remains accessible in read-only form.</p>
            <p>All payment processing is handled by Stripe. We do not store your card number or payment credentials. By subscribing, you agree to <a href="https://stripe.com/legal" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground transition-colors">Stripe's Terms of Service</a>.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">4. Acceptable Use</h2>
          <p className="text-muted-foreground text-sm mb-3">You agree not to:</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              'Use TabMerger for any unlawful purpose or in violation of applicable laws.',
              'Attempt to reverse-engineer, scrape, or systematically extract data from the service using automated means beyond normal use of the extension.',
              'Interfere with or disrupt the integrity or performance of the service or its underlying infrastructure.',
              'Share your account credentials with others or attempt to access another user\'s account.',
              'Use AI features to process tab content that contains sensitive personal data of others without their consent.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-0.5 shrink-0 text-muted-foreground/50">—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm mt-4">We reserve the right to suspend or terminate accounts that violate these terms without prior notice.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">5. Intellectual Property</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>TabMerger and its source code, design, branding, and content are owned by Lior Bragilevsky and are protected by applicable intellectual property laws. Your use of the service does not grant you any ownership rights in the product.</p>
            <p>Your tab data and group configurations are your content — you retain all rights to it. By enabling cloud sync, you grant us a limited license to store and process that content solely to provide the service.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">6. Privacy</h2>
          <p className="text-muted-foreground text-sm">Your use of TabMerger is governed by our <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground transition-colors">Privacy Policy</Link>, which is incorporated into these Terms by reference.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">7. Disclaimer of Warranties</h2>
          <div className="space-y-3 text-muted-foreground text-sm leading-relaxed">
            <p>TabMerger is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the service will be uninterrupted, error-free, or free of harmful components.</p>
            <p>The free tier relies on local browser storage. We have no ability to recover locally stored data if it is cleared or if the extension is uninstalled.</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">8. Limitation of Liability</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">To the maximum extent permitted by applicable law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use the service. Our total liability for any claim shall not exceed the amount you paid us in the 12 months preceding the claim, or $10 USD if you have not paid us anything.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">9. Governing Law</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">These Terms are governed by and construed in accordance with the laws of the jurisdiction in which the operator resides, without regard to conflict of law principles. Any disputes shall be resolved in the courts of that jurisdiction.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">10. Changes to These Terms</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">If we make material changes, we will notify you by email or by displaying a notice in the app at least 14 days before the changes take effect. Continued use of the service after that date constitutes acceptance of the revised Terms. The "last updated" date at the top of this page always reflects the current version.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">11. Termination</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">You may stop using TabMerger and delete your account at any time. We may suspend or terminate your access if you violate these Terms. Upon termination, your right to use the service ceases immediately. Provisions that by their nature should survive termination — including intellectual property, disclaimers, and limitation of liability — will do so.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">12. Contact</h2>
          <p className="text-muted-foreground text-sm">Questions about these Terms? <Link href="/contact" className="underline underline-offset-4 hover:text-foreground transition-colors">Contact us</Link>.</p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t flex gap-4 text-sm text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy →</Link>
      </div>
    </div>
  )
}
