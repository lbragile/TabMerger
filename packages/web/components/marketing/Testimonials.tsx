const testimonials = [
  {
    quote:
      'TabMerger completely changed how I work. I used to have 80+ tabs open and feel overwhelmed. Now I have clean groups and can actually find what I need.',
    author: 'Sarah K.',
    role: 'Product Designer',
    rating: 5,
  },
  {
    quote:
      'The AI auto-grouping is magic. I open a bunch of research tabs, click one button, and they\'re organized perfectly. Saves me 10 minutes every morning.',
    author: 'Marcus T.',
    role: 'Software Engineer',
    rating: 5,
  },
  {
    quote:
      'Simple, fast, and it just works. I\'ve tried five tab managers and this is the only one I\'ve stuck with for more than a week.',
    author: 'Priya M.',
    role: 'Content Strategist',
    rating: 5,
  },
  {
    quote:
      'The cloud sync feature is a game changer. My work tabs are exactly where I left them whether I\'m on my laptop or desktop.',
    author: 'James W.',
    role: 'Marketing Manager',
    rating: 5,
  },
  {
    quote:
      'I was skeptical about paying for a tab manager, but the Pro plan is genuinely worth it. The session restore alone saves me every time my browser crashes.',
    author: 'Ana L.',
    role: 'Researcher',
    rating: 5,
  },
  {
    quote:
      'Ridiculously good extension. The drag-and-drop is smooth, search is instant, and it uses barely any memory. A+++',
    author: 'David C.',
    role: 'Freelance Developer',
    rating: 5,
  },
]

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <svg
          key={i}
          className="h-4 w-4 fill-current text-yellow-500"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

export function Testimonials() {
  return (
    <section className="py-24">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Loved by tab hoarders everywhere
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Join 50,000+ users who&apos;ve reclaimed their browser.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.author}
              className="flex flex-col gap-4 rounded-lg border bg-background p-6"
            >
              <StarRating count={testimonial.rating} />
              <blockquote className="text-sm text-muted-foreground leading-relaxed">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="mt-auto">
                <p className="text-sm font-semibold">{testimonial.author}</p>
                <p className="text-xs text-muted-foreground">
                  {testimonial.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
