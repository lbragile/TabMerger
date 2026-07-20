function StarRating() {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className="h-4 w-4 fill-current text-amber-400" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

const testimonials = [
  {
    quote:
      "I manage three client projects simultaneously and TabMerger is the only reason I haven't lost my mind. Groups per project, cloud sync between machines — it just works.",
    name: 'Rachel D.',
    role: 'Frontend Developer',
  },
  {
    quote:
      "The AI grouping saved me on a research sprint. Opened 40 tabs on three topics, hit the button, and they were sorted in seconds. Genuinely impressive.",
    name: 'Omar S.',
    role: 'UX Researcher',
  },
  {
    quote:
      "Switched from OneTab and never looked back. The search alone is worth it — instant, fuzzy, finds everything. My browser finally feels under control.",
    name: 'Natalie W.',
    role: 'Product Manager',
  },
  {
    quote:
      "I keep 200+ tabs across 6 windows. TabMerger turned that chaos into labeled groups I can actually navigate. Life-changing for my workflow.",
    name: 'James K.',
    role: 'Software Engineer',
  },
  {
    quote:
      "The session save feature is underrated. I close my laptop, reopen, and everything is exactly where I left it. No more recreating research tabs from scratch.",
    name: 'Priya M.',
    role: 'Academic Researcher',
  },
]

export function Testimonials() {
  // ponytail: duplicate array for seamless loop; CSS handles animation
  const doubled = [...testimonials, ...testimonials]

  return (
    <section className="py-8 bg-background">
      {/* Carousel — overflow-hidden clips cards outside viewport */}
      <div className="overflow-hidden">
        <div className="flex animate-marquee" style={{ width: 'max-content' }}>
          {doubled.map((t, i) => (
            <div
              key={i}
              className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-6 mx-3 shrink-0"
              style={{ width: '320px' }}
            >
              <StarRating />
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
