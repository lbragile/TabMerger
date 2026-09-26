import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChromeIcon } from './BrowserIcons'
import { AI_ENABLED } from '@/lib/aiFlag'

export function FinalCta() {
  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 bg-surface2">
      <div className="container max-w-[720px] text-center">
        <h2 className="font-semibold tracking-tight mb-3 text-[28px] sm:text-[34px] leading-tight">
          Stop drowning in browser tabs.
        </h2>
        <p className="text-text2 mb-7 text-[15.5px]">
          {AI_ENABLED
            ? 'Free to start, no account needed. Upgrade any time for cloud sync and AI.'
            : 'Free to start, no account needed. Upgrade any time for cloud sync — AI features coming soon.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="gap-2" asChild>
            <a href="https://chrome.google.com/webstore" target="_blank" rel="noopener noreferrer">
              <ChromeIcon size={18} />
              Install for Chrome — free
            </a>
          </Button>
          <Link href="/faq" className="text-[13.5px] text-text2 hover:text-primary transition-colors">
            Have questions? See the FAQ →
          </Link>
        </div>
      </div>
    </section>
  )
}
