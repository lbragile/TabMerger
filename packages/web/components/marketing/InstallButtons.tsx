import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Chrome } from 'lucide-react'

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
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              variant="secondary"
              className="gap-2"
              asChild
            >
              <a
                href="https://chrome.google.com/webstore"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Chrome className="h-5 w-5" />
                Add to Chrome — It&apos;s Free
              </a>
            </Button>
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
        </div>
      </div>
    </section>
  )
}
