import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { ChromeIcon, FirefoxIcon, EdgeIcon } from './BrowserIcons'

export function InstallButtons() {
  return (
    <section className="py-24">
      <div className="container">
        <div className="rounded-2xl bg-primary px-8 py-16 text-center text-primary-foreground">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to organize your browser?
          </h2>
          <p className="mt-4 text-lg opacity-80 max-w-xl mx-auto">
            Install TabMerger in seconds. No account required to get started.
          </p>

          {/* Browser install buttons */}
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <a
              href="https://chrome.google.com/webstore"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-white text-gray-900 hover:bg-gray-50 transition-colors shadow-xs"
            >
              <ChromeIcon size={20} />
              Add to Chrome
            </a>
            <a
              href="#"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-white text-gray-900 hover:bg-gray-50 transition-colors shadow-xs"
            >
              <FirefoxIcon size={20} />
              Add to Firefox
            </a>
            <a
              href="#"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-white text-gray-900 hover:bg-gray-50 transition-colors shadow-xs"
            >
              <EdgeIcon size={20} />
              Add to Edge
            </a>
          </div>

          {/* Secondary CTA */}
          <div className="mt-6">
            <Button
              size="lg"
              variant="outline"
              className="gap-2 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10"
              asChild
            >
              <Link href="/pricing">
                View pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <p className="mt-4 text-xs opacity-50">
            Free to install — No account required &middot; Edge support coming soon
          </p>
        </div>
      </div>
    </section>
  )
}
