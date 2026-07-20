const reviews = [
  {
    quote: 'TabMerger completely changed how I work. I had 80+ tabs open and felt overwhelmed. Now I have clean groups and can actually find what I need.',
    author: 'Sarah K.',
    handle: '@sarahkdesign',
    rating: 5,
  },
  {
    quote: 'The AI auto-grouping is magic. I open a bunch of research tabs, click one button, and they\'re organized perfectly. Saves me 10 minutes every morning.',
    author: 'Marcus T.',
    handle: '@marcust_dev',
    rating: 5,
  },
  {
    quote: 'Simple, fast, and it just works. I\'ve tried five tab managers and this is the only one I\'ve stuck with for more than a week.',
    author: 'Priya M.',
    handle: '@priyawrites',
    rating: 5,
  },
  {
    quote: 'The cloud sync feature is a game changer. My work tabs are exactly where I left them whether I\'m on my laptop or desktop.',
    author: 'James W.',
    handle: '@jameswmkt',
    rating: 5,
  },
  {
    quote: 'I was skeptical about paying for a tab manager but the Pro plan is genuinely worth it. Session restore alone saves me every time my browser crashes.',
    author: 'Ana L.',
    handle: '@anaresearches',
    rating: 5,
  },
  {
    quote: 'Ridiculously good extension. Drag-and-drop is smooth, search is instant, and it uses barely any memory. A+++',
    author: 'David C.',
    handle: '@david_codes',
    rating: 5,
  },
  {
    quote: 'Finally an extension that doesn\'t slow my browser down. TabMerger is lean and the interface is genuinely beautiful.',
    author: 'Kenji N.',
    handle: '@kenjinakamura',
    rating: 5,
  },
  {
    quote: 'I switched from OneTab after 3 years. TabMerger has everything OneTab has plus search, color coding, and AI. No going back.',
    author: 'Fatima O.',
    handle: '@fatimabuilds',
    rating: 5,
  },
  {
    quote: 'Our whole team uses TabMerger to share research sessions. The export feature is perfect for handoffs.',
    author: 'Tom H.',
    handle: '@tomhpmgr',
    rating: 5,
  },
  {
    quote: 'It\'s rare that a browser extension genuinely improves your day. This one does. Installed it Monday and already can\'t imagine working without it.',
    author: 'Chloe B.',
    handle: '@chloebcreates',
    rating: 5,
  },
]

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} className="h-3.5 w-3.5 fill-current text-yellow-500" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

export function ReviewsStrip() {
  // Duplicate the array so the marquee loops seamlessly
  const doubled = [...reviews, ...reviews]

  return (
    <section className="py-10 overflow-hidden bg-muted/20">
      {/* Edge fade masks */}
      <div className="relative">
        <div className="pointer-events-none absolute left-0 top-0 h-full w-24 z-10 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-24 z-10 bg-gradient-to-l from-background to-transparent" />

        {/* Scrolling track — width is max-content so all cards sit on one line */}
        <div className="flex animate-marquee pause-on-hover w-max gap-4 px-4">
          {doubled.map((review, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-[260px] rounded-xl bg-white shadow-xs border p-4 flex flex-col gap-3"
            >
              <StarRating count={review.rating} />
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                &ldquo;{review.quote}&rdquo;
              </p>
              <div className="mt-auto">
                <p className="text-xs font-semibold">{review.author}</p>
                <p className="text-[11px] text-muted-foreground">{review.handle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
