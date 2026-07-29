import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChromeIcon, FirefoxIcon, EdgeIcon } from './BrowserIcons'
import { DemoSection } from './DemoSection'

export function Hero() {
  return (
    <section className="py-14 px-8 bg-background">
      <div className="container">
        <div className="grid gap-10 items-center grid-cols-1 md:grid-cols-[1fr_1fr]">
          {/* Left col — capped width + ml-auto pulls the text block toward the
              center gutter instead of hugging the far-left edge of the section. */}
          <div className="flex flex-col md:max-w-[34rem] md:ml-auto">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Tab manager for people with too many tabs
            </p>
            <h1
              className="font-bold text-foreground mb-4 text-4xl md:text-[52px]"
              style={{ letterSpacing: '-0.02em', lineHeight: 1.02 }}
            >
              Stop drowning in browser tabs.
            </h1>
            <p className="text-base text-muted-foreground mb-6" style={{ maxWidth: '38ch' }}>
              TabMerger folds every open window into named, colour-coded groups you can search,
              share and restore — on any machine, in one click.
            </p>

            {/* CTA row */}
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <Button size="lg" className="gap-2" asChild>
                <a
                  href="https://chrome.google.com/webstore"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ChromeIcon size={18} />
                  Install for Chrome — free
                </a>
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                <a
                  href="https://addons.mozilla.org/firefox/addon/tabmerger"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FirefoxIcon size={15} />
                  Firefox
                </a>
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                <a
                  href="https://microsoftedge.microsoft.com/addons/detail/tabmerger"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <EdgeIcon size={15} />
                  Edge
                </a>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">Free plan, no account needed.</p>
          </div>

          {/* Right col */}
          <div className="relative">
            <DemoSection />
          </div>
        </div>
      </div>
    </section>
  )
}
