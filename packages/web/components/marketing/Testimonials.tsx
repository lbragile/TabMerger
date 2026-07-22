const testimonials = [
  {
    quote:
      'TabMerger saved my sanity. I had 200+ tabs across 8 windows. Now everything is organised and I can actually find things.',
    attribution: 'ALEX T. · Chrome Web Store',
  },
  {
    quote:
      'The AI grouping is genuinely magic. Dumped a huge research session in and it sorted everything into named groups instantly.',
    attribution: 'PRIYA S. · Product Hunt',
  },
  {
    quote:
      'Session restore is the killer feature. I close everything at night, open it all back in the morning exactly as I left it.',
    attribution: 'MARCO L. · Verified user',
  },
]

export function Testimonials() {
  return (
    <section className="py-12">
      <div className="container">
        <div className="grid grid-cols-3 gap-8">
          {testimonials.map((t) => (
            <div key={t.attribution} className="border-l-2 border-border pl-4">
              <p className="leading-relaxed mb-4" style={{ fontSize: '14px' }}>
                &ldquo;{t.quote}&rdquo;
              </p>
              <p
                className="uppercase text-muted-foreground tracking-wider"
                style={{ fontSize: '11px', fontWeight: 600 }}
              >
                {t.attribution}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
