// ponytail: repurposed from marquee-of-reviews to stats strip per design wireframe
export function ReviewsStrip() {
  const stats = [
    { number: '4.8 / 5', label: 'Chrome Web Store rating' },
    { number: '2,400+', label: 'Weekly active users' },
    { number: '1.2M', label: 'Tabs organized' },
  ]

  return (
    <section className="border-t-2 border-b-2 border-border">
      <div className="container">
        <div className="grid grid-cols-3">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`py-6 px-4 flex flex-col items-center text-center ${i === 1 ? 'border-l-2 border-r-2 border-border' : ''}`}
            >
              <span className="font-extrabold" style={{ fontSize: '30px' }}>
                {stat.number}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
