import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChromeIcon, FirefoxIcon, EdgeIcon } from './BrowserIcons'

export function Hero() {
  return (
    <section className="py-14 px-8 bg-background">
      <div className="container">
        <div className="grid gap-10 items-center" style={{ gridTemplateColumns: '5fr 6fr' }}>
          {/* Left col */}
          <div className="flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Tab manager for people with too many tabs
            </p>
            <h1
              className="font-bold text-foreground mb-4"
              style={{ fontSize: '52px', letterSpacing: '-0.02em', lineHeight: 1.02 }}
            >
              Stop drowning in browser tabs.
            </h1>
            <p className="text-base text-muted-foreground mb-6" style={{ maxWidth: '38ch' }}>
              Group, save and restore every window. Let AI file the mess into named groups —
              synced to every machine you use.
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
            {/* ponytail: "TRY IT" badge positioned top-left of the demo box */}
            <div
              className="absolute -top-3 -left-3 z-10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Try it — no install
            </div>
            <div
              className="border-2 border-foreground bg-muted/50 flex items-center justify-center text-center p-6"
              style={{ height: '320px' }}
            >
              <p className="text-sm text-muted-foreground leading-relaxed">
                Interactive demo — the live popup, embedded and seeded with 24 sample tabs
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
