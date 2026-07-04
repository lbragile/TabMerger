import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Chrome } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-background py-24 sm:py-32">
      <div className="container flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-4 max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Organize your tabs.{' '}
            <span className="text-primary">Reclaim your focus.</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            TabMerger groups your open tabs into a clean, searchable panel —
            saving memory and mental bandwidth.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <Button size="lg" className="gap-2" asChild>
            <a
              href="https://chrome.google.com/webstore"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Chrome className="h-5 w-5" />
              Add to Chrome — It&apos;s Free
            </a>
          </Button>
          <Button variant="outline" size="lg" className="gap-2" asChild>
            <Link href="/features">
              See all features
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <svg className="h-4 w-4 fill-current text-yellow-500" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            4.8 / 5 rating
          </span>
          <span>50,000+ users</span>
          <span>Free to install</span>
        </div>
      </div>
      {/* Decorative background */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[50%] top-0 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/5 blur-3xl" />
      </div>
    </section>
  )
}
